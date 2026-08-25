from __future__ import annotations

from datetime import datetime
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

RESOURCE_RELAY_DIR = Path(__file__).resolve().parents[2] / "resources" / "satanic-zone-relay"
sys.path.insert(0, str(RESOURCE_RELAY_DIR))

try:
    import addon
except ModuleNotFoundError as error:
    if error.name != "mitmproxy":
        raise
    mitmproxy_stub = types.ModuleType("mitmproxy")
    mitmproxy_stub.ctx = types.SimpleNamespace()
    mitmproxy_stub.tcp = types.SimpleNamespace(TCPFlow=object)
    sys.modules["mitmproxy"] = mitmproxy_stub
    try:
        import addon
    finally:
        sys.modules.pop("mitmproxy", None)

PendingCommand = addon.PendingCommand
InjectionAttempt = addon.InjectionAttempt
SatanicZoneRelayAddon = addon.SatanicZoneRelayAddon
TrackedFlow = addon.TrackedFlow
from relay_state import (
    CONSUMED_FILE,
    READY_FILE,
    WIRE_SESSION_FILE,
    atomic_write_json,
    read_json,
    result_file_for_command,
    utc_now,
)
from global_shuffle import MAX_GLOBAL_SHUFFLE_OBSERVATIONS
from sz_frame import (
    OutboundFrameStreamDecoder,
    ParsedFrame,
    SATANIC_ZONE_ROUTE,
    build_frame,
    build_generic_frame,
    computed_generic_token,
    computed_request_token,
    matching_frame_counters,
    parse_frame,
    parse_generic_frame,
    recover_frame_counter,
)


DEFAULT_MITMDUMP = Path(r"C:\Program Files\mitmproxy\bin\mitmdump.exe")
ZONE_RESPONSE = b'{"satanicZoneName":"Test","buffs":"1","debuffs":"2"}'
GENERIC_RESPONSE = b'{"ok":true}'


class FakeTimerHandle:
    def __init__(self, delay: float, callback: object) -> None:
        self.delay = delay
        self.callback = callback
        self.was_cancelled = False

    def cancel(self) -> None:
        self.was_cancelled = True

    def cancelled(self) -> bool:
        return self.was_cancelled

    def fire(self) -> None:
        if self.was_cancelled:
            raise AssertionError("Cancelled timer must not fire.")
        self.callback()  # type: ignore[operator]


class FakeEventLoop:
    def __init__(self) -> None:
        self.handles: list[FakeTimerHandle] = []

    def call_later(self, delay: float, callback: object) -> FakeTimerHandle:
        handle = FakeTimerHandle(delay, callback)
        self.handles.append(handle)
        return handle


def request_body() -> bytes:
    return (
        b"\x03\x00\x01\x00"
        + SATANIC_ZONE_ROUTE
        + b"\0R\0unique_account_id=12345678"
        + b"&crossregion_identifier=12345678901&beta=0\0"
    )


def authenticated_api_body(route: bytes = b"mailbox/mailbox_check_new") -> bytes:
    return (
        b"\x03\x00\x01\x00"
        + route
        + b"\0R\0unique_account_id=12345678"
        + b"&crossregion_identifier=12345678901\0"
    )


def unique_generic_frame(prefix: str, counter: int) -> bytes:
    for suffix in range(4096):
        body = f"{prefix}-{suffix}\0".encode("ascii")
        frame = build_generic_frame(body, computed_generic_token(body, counter))
        if matching_frame_counters(parse_generic_frame(frame)) == (counter,):
            return frame
    raise AssertionError("Could not construct a unique generic counter fixture.")


def find_mitmdump() -> str | None:
    discovered = shutil.which("mitmdump")
    if discovered:
        return discovered
    if DEFAULT_MITMDUMP.exists():
        return str(DEFAULT_MITMDUMP)
    return None


def reserve_port() -> int:
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            port = int(listener.getsockname()[1])
        if port not in {6668, 6669}:
            return port


def wait_until(predicate, timeout: float = 8.0, interval: float = 0.05) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return bool(predicate())


def read_events(state_dir: Path) -> list[dict[str, object]]:
    try:
        lines = (state_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    return [json.loads(line) for line in lines if line.strip()]


class FakeTcpServer:
    def __init__(self, port: int) -> None:
        self.port = port
        self.frames: list[bytes] = []
        self.sequence_validations: list[bool] = []
        self.flow_frames: dict[int, list[bytes]] = {}
        self.flow_sequence_validations: dict[int, list[bool]] = {}
        self.duplicate_counter_seen = False
        self.latest_counters: dict[int, int] = {}
        self.error: BaseException | None = None
        self.ready = threading.Event()
        self.stop_requested = threading.Event()
        self.listener: socket.socket | None = None
        self.connections: list[socket.socket] = []
        self.workers: list[threading.Thread] = []
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._serve, daemon=True)

    def start(self) -> None:
        self.thread.start()
        if not self.ready.wait(3):
            raise RuntimeError("Fake TCP server did not start.")

    def stop(self) -> None:
        self.stop_requested.set()
        for sock in [*self.connections, self.listener]:
            if sock is not None:
                try:
                    sock.close()
                except OSError:
                    pass
        self.thread.join(timeout=3)
        for worker in self.workers:
            worker.join(timeout=3)

    def _serve(self) -> None:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                self.listener = listener
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                listener.bind(("127.0.0.1", self.port))
                listener.listen(8)
                listener.settimeout(0.2)
                self.ready.set()
                while not self.stop_requested.is_set():
                    try:
                        connection, _ = listener.accept()
                    except socket.timeout:
                        continue
                    connection.settimeout(0.2)
                    with self.lock:
                        flow_number = len(self.connections)
                        self.connections.append(connection)
                        self.flow_frames[flow_number] = []
                        self.flow_sequence_validations[flow_number] = []
                    worker = threading.Thread(
                        target=self._serve_connection,
                        args=(flow_number, connection),
                        daemon=True,
                    )
                    self.workers.append(worker)
                    worker.start()
        except OSError as error:
            if not self.stop_requested.is_set():
                self.error = error
        except BaseException as error:
            self.error = error
        finally:
            self.ready.set()

    def _serve_connection(self, flow_number: int, connection: socket.socket) -> None:
        decoder = OutboundFrameStreamDecoder()
        try:
            with connection:
                while not self.stop_requested.is_set():
                    try:
                        chunk = connection.recv(4096)
                    except socket.timeout:
                        continue
                    if not chunk:
                        return
                    for decoded in decoder.feed(chunk):
                        if not isinstance(decoded, ParsedFrame):
                            raise AssertionError(
                                "Fake server received unaccounted outbound bytes."
                            )
                        matches = matching_frame_counters(decoded)
                        with self.lock:
                            latest_counter = self.latest_counters.get(flow_number)
                            expected_counter = (
                                (latest_counter + 1) % 256
                                if latest_counter is not None
                                else None
                            )
                            if (
                                expected_counter is not None
                                and expected_counter in matches
                            ):
                                recovered_counter = expected_counter
                            elif len(matches) == 1:
                                recovered_counter = matches[0]
                            else:
                                recovered_counter = None
                            sequence_valid = recovered_counter is not None and (
                                latest_counter is None
                                or recovered_counter == (latest_counter + 1) % 256
                            )
                            if (
                                recovered_counter is not None
                                and latest_counter is not None
                                and recovered_counter == latest_counter
                            ):
                                self.duplicate_counter_seen = True
                            if sequence_valid:
                                self.latest_counters[flow_number] = recovered_counter
                            self.frames.append(decoded.raw)
                            self.sequence_validations.append(sequence_valid)
                            self.flow_frames[flow_number].append(decoded.raw)
                            self.flow_sequence_validations[flow_number].append(
                                sequence_valid
                            )
                        connection.sendall(
                            ZONE_RESPONSE
                            if decoded.is_satanic_zone_request
                            else GENERIC_RESPONSE
                        )
        except OSError as error:
            if not self.stop_requested.is_set():
                self.error = error
        except BaseException as error:
            self.error = error


class ComputedDispatchSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        wire_enabled = patch.object(addon, "WIRE_CONFIRMATION_ENABLED", True)
        wire_ports = patch.object(
            addon,
            "WIRE_CONFIRMATION_PORTS",
            {6669, 7444, 7445, 7446, 7447},
        )
        wire_enabled.start()
        wire_ports.start()
        wire_session_id = patch.object(addon, "WIRE_SESSION_ID", "unit-wire-session")
        wire_process = patch.object(addon, "process_is_alive", return_value=True)
        wire_session_id.start()
        wire_process.start()
        self.addCleanup(wire_process.stop)
        self.addCleanup(wire_session_id.stop)
        self.addCleanup(wire_ports.stop)
        self.addCleanup(wire_enabled.stop)

    def test_product_ready_contract_is_the_only_persisted_runtime_state(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-unit-") as temporary:
            state_dir = Path(temporary)
            poc = SatanicZoneRelayAddon()
            captured_coroutines: list[object] = []

            def close_command_loop(coroutine: object) -> object:
                captured_coroutines.append(coroutine)
                coroutine.close()  # type: ignore[attr-defined]
                return types.SimpleNamespace(cancel=lambda: None)

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon.asyncio, "create_task", side_effect=close_command_loop
            ):
                poc.one_shot_consumed = False
                poc.running()
                ready = read_json(state_dir / READY_FILE)
                persisted_while_running = {
                    path.name for path in state_dir.iterdir() if path.is_file()
                }
                poc.done()

            self.assertEqual(len(captured_coroutines), 1)
            self.assertEqual(
                set(ready or {}),
                {
                    "schemaVersion",
                    "status",
                    "sessionId",
                    "pid",
                    "startedAt",
                    "repeatableRefresh",
                    "counterTranslation",
                    "parentLiveness",
                    "commandCooldownMs",
                    "requestSeeded",
                    "requestReady",
                },
            )
            self.assertEqual(ready and ready.get("status"), "ready")
            self.assertEqual(ready and ready.get("sessionId"), "a" * 32)
            self.assertIs(ready and ready.get("repeatableRefresh"), True)
            self.assertIs(ready and ready.get("counterTranslation"), True)
            self.assertIs(ready and ready.get("parentLiveness"), True)
            self.assertEqual(ready and ready.get("commandCooldownMs"), 30_000)
            self.assertIs(ready and ready.get("requestSeeded"), False)
            self.assertIs(ready and ready.get("requestReady"), False)
            self.assertEqual(persisted_while_running, {READY_FILE})
            self.assertFalse((state_dir / READY_FILE).exists())

    def test_product_request_readiness_tracks_armed_health_without_private_evidence(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-ready-") as temporary:
            state_dir = Path(temporary)
            clock = [100.0]
            poc = SatanicZoneRelayAddon()

            def close_command_loop(coroutine: object) -> object:
                coroutine.close()  # type: ignore[attr-defined]
                return types.SimpleNamespace(cancel=lambda: None)

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon, "PRODUCT_DISPATCH_INTERVAL_SECONDS", 30.0
            ), patch.object(
                addon.time, "monotonic", side_effect=lambda: clock[0]
            ), patch.object(
                addon.asyncio, "create_task", side_effect=close_command_loop
            ):
                poc.running()
                self.assertIs(
                    (read_json(state_dir / READY_FILE) or {}).get("requestReady"),
                    False,
                )

                _target, state, _other = self._establish_flow_local_scope(
                    poc,
                    clock,
                    70,
                )
                poc._refresh_latest_armed_state(clock[0], force=True)
                ready = read_json(state_dir / READY_FILE)
                self.assertIs(ready and ready.get("requestSeeded"), True)
                self.assertIs(ready and ready.get("requestReady"), True)

                serialized_ready = json.dumps(ready, sort_keys=True).lower()
                for forbidden in (
                    "token",
                    "body",
                    "account",
                    "endpoint",
                    "remoteaddress",
                    "remoteport",
                    "flowid",
                    "sha256",
                    "countervalue",
                    "scopeevidence",
                    "selectedscope",
                ):
                    self.assertNotIn(forbidden, serialized_ready)

                # Server recency is not a protocol condition. Only an
                # incomplete target decoder boundary makes this context
                # temporarily non-dispatchable.
                state.last_server_at = clock[0]
                poc._write_product_ready_state(clock[0])
                self.assertIs(
                    (read_json(state_dir / READY_FILE) or {}).get("requestSeeded"),
                    True,
                )
                self.assertIs(
                    (read_json(state_dir / READY_FILE) or {}).get("requestReady"),
                    True,
                )
                partial_body = authenticated_api_body(b"mailbox/partial")
                partial_frame = build_frame(
                    partial_body,
                    computed_request_token(partial_body, 74),
                )
                state.decoder.feed(partial_frame[:7])
                poc._write_product_ready_state(clock[0])
                self.assertIs(
                    (read_json(state_dir / READY_FILE) or {}).get("requestSeeded"),
                    True,
                )
                self.assertIs(
                    (read_json(state_dir / READY_FILE) or {}).get("requestReady"),
                    False,
                )
                state.decoder.feed(partial_frame[7:])
                poc._write_product_ready_state(clock[0])
                self.assertIs(
                    (read_json(state_dir / READY_FILE) or {}).get("requestReady"),
                    True,
                )

                poc.pending_command = PendingCommand("f" * 32, "computed", clock[0])
                poc._write_product_ready_state(clock[0])
                self.assertIs(
                    (read_json(state_dir / READY_FILE) or {}).get("requestSeeded"),
                    True,
                )
                self.assertIs(
                    (read_json(state_dir / READY_FILE) or {}).get("requestReady"),
                    False,
                )
                poc._reject_pending("unit_readiness_recheck")
                self.assertIs(
                    (read_json(state_dir / READY_FILE) or {}).get("requestReady"),
                    True,
                )
                poc.done()

    def test_product_parent_liveness_requests_clean_shutdown_exactly_once(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-parent-") as temporary:
            state_dir = Path(temporary)
            shutdown_calls: list[bool] = []
            fake_ctx = types.SimpleNamespace(
                master=types.SimpleNamespace(
                    shutdown=lambda: shutdown_calls.append(True),
                )
            )
            poc = SatanicZoneRelayAddon()
            poc.product_started_wall_at = "2026-08-24T00:00:00Z"

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "ctx", fake_ctx
            ), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", 4321
            ), patch.object(
                addon, "process_is_alive", side_effect=[True, False]
            ) as alive:
                self.assertTrue(poc._check_product_parent_liveness())
                self.assertFalse(poc._check_product_parent_liveness())
                self.assertFalse(poc._check_product_parent_liveness())

            self.assertEqual(alive.call_count, 2)
            self.assertEqual(shutdown_calls, [True])
            self.assertIs(
                (read_json(state_dir / READY_FILE) or {}).get("requestReady"),
                False,
            )

    def test_product_missing_parent_pid_fails_closed(self) -> None:
        shutdown_calls: list[bool] = []
        fake_ctx = types.SimpleNamespace(
            master=types.SimpleNamespace(shutdown=lambda: shutdown_calls.append(True))
        )
        poc = SatanicZoneRelayAddon()
        with patch.object(addon, "ctx", fake_ctx), patch.object(
            addon, "PRODUCT_RELAY_MODE", True
        ), patch.object(
            addon, "PRODUCT_SESSION_VALID", True
        ), patch.object(
            addon, "PRODUCT_PARENT_PID", None
        ), patch.object(addon, "process_is_alive") as alive:
            self.assertFalse(addon._injection_allowed())
            self.assertFalse(poc._check_product_parent_liveness())
            self.assertFalse(poc._check_product_parent_liveness())

        alive.assert_not_called()
        self.assertEqual(shutdown_calls, [True])

    def test_product_managed_command_contract_and_helper_cooldown(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-unit-") as temporary:
            state_dir = Path(temporary)
            clock = [100.0]
            poc = SatanicZoneRelayAddon()
            command_id = "1" * 32
            command = {
                "schemaVersion": 1,
                "command": "refresh_satanic_zone",
                "commandId": command_id,
                "sessionId": "a" * 32,
                "requestedAt": "2026-08-24T00:00:00Z",
                "minimumDispatchSpacingMs": 30_000,
            }

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon, "PRODUCT_DISPATCH_INTERVAL_SECONDS", 30.0
            ), patch.object(
                addon.time, "monotonic", side_effect=lambda: clock[0]
            ):
                (state_dir / "command.json").write_text(
                    json.dumps(command),
                    encoding="utf-8",
                )
                poc._ingest_command()
                self.assertEqual(
                    poc.pending_command and poc.pending_command.command_id,
                    command_id,
                )
                poc.pending_command = None
                poc.last_dispatch_at = clock[0]
                clock[0] += 29.999
                second_id = "2" * 32
                command["commandId"] = second_id
                (state_dir / "command.json").write_text(
                    json.dumps(command),
                    encoding="utf-8",
                )
                poc._ingest_command()

            result = read_json(
                state_dir / result_file_for_command(second_id)
            )
            self.assertIsNone(result)
            self.assertEqual(
                poc.pending_command and poc.pending_command.command_id,
                second_id,
            )
            self.assertFalse((state_dir / CONSUMED_FILE).exists())

    def test_product_two_dispatches_advance_offset_and_emit_terminal_results(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-unit-") as temporary:
            state_dir = Path(temporary)
            calls: list[tuple[object, ...]] = []
            clock = [100.0]
            poc = SatanicZoneRelayAddon()

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "ctx", self._fake_ctx(calls)
            ), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon, "PRODUCT_DISPATCH_INTERVAL_SECONDS", 30.0
            ), patch.object(
                addon.time, "monotonic", side_effect=lambda: clock[0]
            ):
                target, state, other = self._establish_flow_local_scope(
                    poc,
                    clock,
                    120,
                )

                first_id = "3" * 32
                poc.pending_command = PendingCommand(first_id, "computed", clock[0])
                poc._maybe_dispatch()
                self.assertEqual(recover_frame_counter(calls[0][3]), 124)
                poc._observe_server_payload(state, ZONE_RESPONSE)
                first_anchor_body = b"product-first-target-anchor"
                first_anchor = build_frame(
                    first_anchor_body,
                    computed_request_token(first_anchor_body, 124),
                )
                target.messages.append(
                    types.SimpleNamespace(from_client=True, content=first_anchor)
                )
                poc.tcp_message(target)

                self.assertEqual(recover_frame_counter(target.messages[-1].content), 125)
                self.assertIsNotNone(state.counter_translation)
                assert state.counter_translation is not None
                self.assertEqual(state.counter_translation.counter_offset, 1)
                first_result = read_json(
                    state_dir / result_file_for_command(first_id)
                )
                self.assertEqual(first_result and first_result.get("status"), "success")
                self.assertIs(
                    first_result and first_result.get("counterTranslationActive"),
                    True,
                )
                self.assertIsInstance(
                    first_result and first_result.get("zoneObservation"),
                    dict,
                )
                serialized_result = json.dumps(first_result, sort_keys=True).lower()
                for forbidden in (
                    "token",
                    "body",
                    "account",
                    "endpoint",
                    "remoteaddress",
                    "remoteport",
                    "flowid",
                    "sha256",
                    "scopeevidence",
                    "selectedscope",
                ):
                    self.assertNotIn(forbidden, serialized_result)

                clock[0] += 26.0
                for step, native_counter in enumerate((125, 126, 127, 128), start=1):
                    clock[0] += 0.6
                    other_counter = 182 + step
                    other_body = f"product-other-{other_counter}".encode("ascii")
                    other_frame = build_frame(
                        other_body,
                        computed_request_token(other_body, other_counter),
                    )
                    other.messages.append(
                        types.SimpleNamespace(
                            from_client=True,
                            content=other_frame,
                        )
                    )
                    poc.tcp_message(other)
                    clock[0] += 0.6
                    native_body = f"product-cooldown-{native_counter}".encode("ascii")
                    native_frame = build_frame(
                        native_body,
                        computed_request_token(native_body, native_counter),
                    )
                    target.messages.append(
                        types.SimpleNamespace(
                            from_client=True,
                            content=native_frame,
                        )
                    )
                    poc.tcp_message(target)
                state.last_client_at = clock[0] - addon.SCOPE_QUIESCENCE_SECONDS - 1
                state.last_server_at = clock[0] - addon.SERVER_IDLE_SECONDS - 1
                poc.flows[other.id].last_client_at = (
                    clock[0] - addon.SCOPE_QUIESCENCE_SECONDS - 1
                )
                second_id = "4" * 32
                poc.pending_command = PendingCommand(second_id, "computed", clock[0])
                poc._maybe_dispatch()
                self.assertIsNone(poc.dispatch_arm)
                self.assertEqual(recover_frame_counter(calls[1][3]), 130)
                self.assertEqual(state.counter_translation.counter_offset, 2)
                poc._observe_server_payload(state, ZONE_RESPONSE)
                second_anchor_body = b"product-second-target-anchor"
                second_anchor = build_frame(
                    second_anchor_body,
                    computed_request_token(second_anchor_body, 129),
                )
                target.messages.append(
                    types.SimpleNamespace(from_client=True, content=second_anchor)
                )
                poc.tcp_message(target)

                self.assertEqual(recover_frame_counter(target.messages[-1].content), 131)
                self.assertEqual(state.counter_translation.counter_offset, 2)
                self.assertEqual(state.counter_translation.last_client_counter, 129)

                second_result = read_json(
                    state_dir / result_file_for_command(second_id)
                )
                self.assertEqual(second_result and second_result.get("status"), "success")
                poc._close_flow(target, "tcp_end")
                replacement = self._flow("product-reconnect", b"")
                replacement_state = poc._ensure_flow(replacement)

            self.assertEqual([call[0] for call in calls], ["inject.tcp", "inject.tcp"])
            self.assertFalse((state_dir / CONSUMED_FILE).exists())
            self.assertIsNotNone(replacement_state)
            assert replacement_state is not None
            self.assertIsNone(replacement_state.counter_translation)

    def test_product_translation_uncertainty_requests_flow_kill_once(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-unit-") as temporary:
            state_dir = Path(temporary)
            calls: list[tuple[object, ...]] = []
            flow = self._flow("product-uncertain-flow", b"not-framed!")
            state = TrackedFlow(flow, "203.0.113.8", 6669)
            state.counter_translation = addon.OutboundApiCounterTranslator(10)
            poc = SatanicZoneRelayAddon()
            poc.flows[flow.id] = state
            now = time.monotonic()
            poc.attempt = InjectionAttempt(
                command_id="5" * 32,
                strategy="computed",
                flow_id=flow.id,
                started_at=now,
                started_wall_at="2026-08-24T00:00:00Z",
                response_deadline=now + 10,
                stable_deadline=now + 60,
                selected_scope="flow_local",
                counter_translation_armed=True,
            )

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "ctx", self._fake_ctx(calls)
            ), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ):
                poc.tcp_message(flow)
                flow.messages.append(
                    types.SimpleNamespace(from_client=True, content=b"still-ambiguous")
                )
                poc.tcp_message(flow)

            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0], "flow.kill")
            self.assertEqual(calls[0][1], [flow])
            self.assertTrue(state.flow_recycle_requested)
            self.assertEqual(flow.messages[-1].content, b"")
            self.assertFalse((state_dir / "events.jsonl").exists())
            self.assertFalse((state_dir / "result.json").exists())
            self.assertFalse((state_dir / "armed.json").exists())

    def test_product_api_context_survives_age_and_clears_on_flow_replacement(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-seed-") as temporary:
            state_dir = Path(temporary)
            calls: list[tuple[object, ...]] = []
            clock = [100.0]
            poc = SatanicZoneRelayAddon()
            poc.product_started_wall_at = "2026-08-24T00:00:00Z"

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "ctx", self._fake_ctx(calls)
            ), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon.time, "monotonic", side_effect=lambda: clock[0]
            ):
                target, state, other = self._establish_flow_local_scope(
                    poc,
                    clock,
                    40,
                )
                self.assertTrue(poc._product_request_is_seeded())
                original_context_at = state.last_api_observed_at

                clock[0] += addon.FRAME_MAX_AGE_SECONDS + 1
                poc._write_product_ready_state(clock[0])
                ready = read_json(state_dir / READY_FILE)
                self.assertIs(ready and ready.get("requestSeeded"), True)
                self.assertIs(ready and ready.get("requestReady"), True)
                self.assertIsNone(state.captured_frame)
                self.assertEqual(
                    state.last_api_observed_at,
                    original_context_at,
                )

                for step in range(1, 5):
                    clock[0] += 0.6
                    other_counter = 182 + step
                    other_body = f"aged-seed-other-{step}".encode("ascii")
                    other.messages.append(
                        types.SimpleNamespace(
                            from_client=True,
                            content=build_frame(
                                other_body,
                                computed_request_token(other_body, other_counter),
                            ),
                        )
                    )
                    poc.tcp_message(other)
                    clock[0] += 0.6
                    target_counter = 43 + step
                    target_body = f"aged-seed-target-{step}".encode("ascii")
                    target.messages.append(
                        types.SimpleNamespace(
                            from_client=True,
                            content=build_frame(
                                target_body,
                                computed_request_token(target_body, target_counter),
                            ),
                        )
                    )
                    poc.tcp_message(target)
                state.last_client_at = (
                    clock[0] - addon.SCOPE_QUIESCENCE_SECONDS - 1
                )
                state.last_server_at = clock[0] - addon.SERVER_IDLE_SECONDS - 1
                poc.flows[other.id].last_client_at = (
                    clock[0] - addon.SCOPE_QUIESCENCE_SECONDS - 1
                )
                command_id = "a" * 32
                poc.pending_command = PendingCommand(
                    command_id,
                    "computed",
                    clock[0],
                )
                poc._maybe_dispatch()
                self.assertIsNone(poc.dispatch_arm)
                self.assertEqual(recover_frame_counter(calls[0][3]), 48)
                poc._observe_server_payload(state, ZONE_RESPONSE)
                result = read_json(
                    state_dir / result_file_for_command(command_id)
                )
                self.assertEqual(result and result.get("status"), "success")
                self.assertGreater(
                    state.last_api_observed_at,
                    original_context_at,
                )

                replacement = self._flow(target.id, b"")
                replacement_state = poc._ensure_flow(replacement)
                poc._write_product_ready_state(clock[0])
                ready = read_json(state_dir / READY_FILE)

            self.assertIsNotNone(replacement_state)
            self.assertIs(ready and ready.get("requestSeeded"), False)
            self.assertIs(ready and ready.get("requestReady"), False)
            self.assertIsNone(state.captured_frame)
            self.assertIsNone(replacement_state.unique_account_id)

    def test_product_command_ignores_client_and_server_idle_guardrails(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-queued-") as temporary:
            state_dir = Path(temporary)
            calls: list[tuple[object, ...]] = []
            clock = [100.0]
            poc = SatanicZoneRelayAddon()
            poc.product_started_wall_at = "2026-08-24T00:00:00Z"

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "ctx", self._fake_ctx(calls)
            ), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon.time, "monotonic", side_effect=lambda: clock[0]
            ):
                _target, state, other = self._establish_flow_local_scope(
                    poc,
                    clock,
                    60,
                )
                state.last_client_at = clock[0]
                state.last_server_at = clock[0]
                poc.flows[other.id].last_client_at = clock[0]
                command_id = "6" * 32
                poc.pending_command = PendingCommand(
                    command_id,
                    "computed",
                    clock[0],
                )
                poc._maybe_dispatch()
                self.assertIsNone(poc.pending_command)
                self.assertIsNone(poc.dispatch_arm)
                poc._write_product_ready_state(clock[0])
                ready = read_json(state_dir / READY_FILE)
                self.assertIs(ready and ready.get("requestSeeded"), True)
                self.assertIs(ready and ready.get("requestReady"), False)
                self.assertEqual(recover_frame_counter(calls[0][3]), 64)

    def test_product_command_waits_for_complete_target_decoder_boundary(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-timer-") as temporary:
            state_dir = Path(temporary)
            calls: list[tuple[object, ...]] = []
            clock = [100.0]
            poc = SatanicZoneRelayAddon()
            poc.product_started_wall_at = "2026-08-24T00:00:00Z"

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "ctx", self._fake_ctx(calls)
            ), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon.time, "monotonic", side_effect=lambda: clock[0]
            ):
                target, state, _other = self._establish_flow_local_scope(
                    poc,
                    clock,
                    70,
                )
                next_body = authenticated_api_body(b"mailbox/next")
                next_frame = build_frame(
                    next_body,
                    computed_request_token(next_body, 74),
                )
                target.messages.append(
                    types.SimpleNamespace(
                        from_client=True,
                        content=next_frame[:7],
                    )
                )
                poc.tcp_message(target)
                first_id = "b" * 32
                poc.pending_command = PendingCommand(first_id, "computed", clock[0])
                poc._maybe_dispatch()
                self.assertEqual(state.decoder.buffered_bytes, 7)
                self.assertIsNotNone(poc.pending_command)
                self.assertEqual(calls, [])

                target.messages.append(
                    types.SimpleNamespace(
                        from_client=True,
                        content=next_frame[7:],
                    )
                )
                poc.tcp_message(target)

            self.assertIsNone(poc.pending_command)
            self.assertIsNone(poc.dispatch_arm)
            self.assertEqual([call[0] for call in calls], ["inject.tcp"])
            self.assertEqual(recover_frame_counter(calls[0][3]), 75)

    def test_product_command_during_relay_cooldown_queues_then_dispatches(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-cooldown-") as temporary:
            state_dir = Path(temporary)
            calls: list[tuple[object, ...]] = []
            clock = [100.0]
            loop = FakeEventLoop()
            poc = SatanicZoneRelayAddon()
            poc.product_started_wall_at = "2026-08-24T00:00:00Z"
            command_id = "d" * 32
            command = {
                "schemaVersion": 1,
                "command": "refresh_satanic_zone",
                "commandId": command_id,
                "sessionId": "a" * 32,
                "requestedAt": "2026-08-24T00:00:00Z",
                "minimumDispatchSpacingMs": 30_000,
            }

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "ctx", self._fake_ctx(calls)
            ), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon, "PRODUCT_DISPATCH_INTERVAL_SECONDS", 30.0
            ), patch.object(
                addon.time, "monotonic", side_effect=lambda: clock[0]
            ), patch.object(
                addon.asyncio, "get_running_loop", return_value=loop
            ):
                target, state, other = self._establish_flow_local_scope(
                    poc,
                    clock,
                    120,
                )
                state.counter_translation = addon.OutboundApiCounterTranslator(123)
                prior_dispatch_at = clock[0] - 29.5
                poc.last_dispatch_at = prior_dispatch_at
                state.last_client_at = (
                    clock[0] - addon.SCOPE_QUIESCENCE_SECONDS - 1
                )
                state.last_server_at = clock[0] - addon.SERVER_IDLE_SECONDS - 1
                poc.flows[other.id].last_client_at = (
                    clock[0] - addon.SCOPE_QUIESCENCE_SECONDS - 1
                )
                (state_dir / "command.json").write_text(
                    json.dumps(command),
                    encoding="utf-8",
                )
                poc._ingest_command()
                poc._maybe_dispatch()
                self.assertEqual(
                    poc.pending_command and poc.pending_command.command_id,
                    command_id,
                )
                self.assertIsNone(poc.dispatch_arm)
                self.assertIsNone(
                    read_json(state_dir / result_file_for_command(command_id))
                )
                self.assertEqual(len(loop.handles), 1)
                self.assertAlmostEqual(loop.handles[0].delay, 0.5)

                clock[0] += 0.5
                loop.handles[0].fire()
                self.assertIsNone(poc.dispatch_arm)
                self.assertIsNone(poc.pending_command)

            self.assertEqual([call[0] for call in calls], ["inject.tcp"])
            self.assertGreaterEqual(
                (poc.last_dispatch_at or 0) - prior_dispatch_at,
                30.0,
            )

    def test_product_queued_command_times_out_without_erasing_api_context(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-deadline-") as temporary:
            state_dir = Path(temporary)
            clock = [100.0]
            poc = SatanicZoneRelayAddon()
            poc.product_started_wall_at = "2026-08-24T00:00:00Z"
            command_id = "7" * 32
            self.assertEqual(addon.PRODUCT_COMMAND_WAIT_SECONDS, 20.0)

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon.time, "monotonic", side_effect=lambda: clock[0]
            ):
                _target, state, _other = self._establish_flow_local_scope(
                    poc,
                    clock,
                    80,
                )
                partial_body = b"deadline-partial-frame"
                partial_frame = build_frame(
                    partial_body,
                    computed_request_token(partial_body, 84),
                )
                state.decoder.feed(partial_frame[:7])
                poc.pending_command = PendingCommand(
                    command_id,
                    "computed",
                    clock[0] - addon.PRODUCT_COMMAND_WAIT_SECONDS,
                )
                poc._expire_pending_command()
                result = read_json(
                    state_dir / result_file_for_command(command_id)
                )
                seed_retained = poc._product_request_is_seeded()

            self.assertIsNone(poc.pending_command)
            self.assertEqual(result and result.get("status"), "timeout")
            self.assertTrue(seed_retained)
            self.assertIsNone(state.captured_frame)
            self.assertIsNotNone(state.unique_account_id)

    def test_product_initial_and_repeat_dispatch_ignore_scope_proof(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-continuity-") as temporary:
            state_dir = Path(temporary)
            calls: list[tuple[object, ...]] = []
            clock = [100.0]
            poc = SatanicZoneRelayAddon()
            poc.product_started_wall_at = "2026-08-24T00:00:00Z"

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "ctx", self._fake_ctx(calls)
            ), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon, "PRODUCT_DISPATCH_INTERVAL_SECONDS", 30.0
            ), patch.object(
                addon.time, "monotonic", side_effect=lambda: clock[0]
            ):
                target, state, other = self._establish_flow_local_scope(
                    poc,
                    clock,
                    100,
                )
                first_id = "8" * 32
                poc.pending_command = PendingCommand(first_id, "computed", clock[0])
                poc.counter_scope.taint_model()
                poc._maybe_dispatch()
                self.assertIsNone(poc.dispatch_arm)
                self.assertEqual(recover_frame_counter(calls[0][3]), 104)
                poc._observe_server_payload(state, ZONE_RESPONSE)
                first_anchor_body = b"product-bounded-first-anchor"
                target.messages.append(
                    types.SimpleNamespace(
                        from_client=True,
                        content=build_frame(
                            first_anchor_body,
                            computed_request_token(first_anchor_body, 104),
                        ),
                    )
                )
                poc.tcp_message(target)
                self.assertEqual(recover_frame_counter(target.messages[-1].content), 105)
                renewed_at = state.last_api_observed_at

                clock[0] += 30.1
                state.last_client_at = clock[0] - addon.SCOPE_QUIESCENCE_SECONDS - 1
                state.last_server_at = clock[0] - addon.SERVER_IDLE_SECONDS - 1
                poc.flows[other.id].last_client_at = (
                    clock[0] - addon.SCOPE_QUIESCENCE_SECONDS - 1
                )
                poc.counter_scope = addon.CounterScopeTracker()
                second_id = "9" * 32
                poc.pending_command = PendingCommand(second_id, "computed", clock[0])
                poc._maybe_dispatch()
                self.assertIsNone(poc.dispatch_arm)
                self.assertEqual(recover_frame_counter(calls[1][3]), 106)
                poc._observe_server_payload(state, ZONE_RESPONSE)

                second_anchor_body = b"product-translated-repeat-anchor"
                target.messages.append(
                    types.SimpleNamespace(
                        from_client=True,
                        content=build_frame(
                            second_anchor_body,
                            computed_request_token(second_anchor_body, 105),
                        ),
                    )
                )
                poc.tcp_message(target)
                self.assertEqual(recover_frame_counter(target.messages[-1].content), 107)
                self.assertGreater(state.last_api_observed_at, renewed_at)
                self.assertTrue(poc._product_request_is_seeded())

                target.messages.append(
                    types.SimpleNamespace(from_client=True, content=b"not-framed!")
                )
                poc.tcp_message(target)
                seed_after_translation_failure = poc._product_request_is_seeded()

            self.assertEqual([call[0] for call in calls[:2]], ["inject.tcp", "inject.tcp"])
            self.assertEqual(calls[-1][0], "flow.kill")
            self.assertTrue(state.flow_recycle_requested)
            self.assertFalse(seed_after_translation_failure)
            self.assertIsNone(state.captured_frame)

    def test_product_dispatch_synthesizes_from_ordinary_api_without_sz_seed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-context-") as temporary:
            state_dir = Path(temporary)
            calls: list[tuple[object, ...]] = []
            clock = [100.0]
            poc = SatanicZoneRelayAddon()
            flow_body = authenticated_api_body()
            flow = self._flow(
                "ordinary-api-flow",
                build_frame(
                    flow_body,
                    computed_request_token(flow_body, 33),
                ),
            )

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "ctx", self._fake_ctx(calls)
            ), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon.time, "monotonic", side_effect=lambda: clock[0]
            ):
                poc.tcp_message(flow)
                state = poc.flows[flow.id]
                self.assertIsNone(state.captured_frame)
                self.assertIsNone(state.normal_request)
                self.assertEqual(state.last_api_counter, 33)

                command_id = "e" * 32
                poc.pending_command = PendingCommand(
                    command_id,
                    "computed",
                    clock[0],
                )
                poc._maybe_dispatch()

            self.assertIsNone(poc.pending_command)
            self.assertIsNone(poc.dispatch_arm)
            self.assertEqual([call[0] for call in calls], ["inject.tcp"])
            injected = parse_frame(calls[0][3])
            self.assertEqual(
                injected.body,
                request_body(),
            )
            self.assertEqual(matching_frame_counters(injected), (34,))
            self.assertIsNotNone(state.counter_translation)

    def test_product_response_timeout_starts_when_proxy_observes_injected_frame(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-response-clock-") as temporary:
            state_dir = Path(temporary)
            calls: list[tuple[object, ...]] = []
            clock = [100.0]
            poc = SatanicZoneRelayAddon()
            flow_body = authenticated_api_body()
            flow = self._flow(
                "delayed-injection-flow",
                build_frame(
                    flow_body,
                    computed_request_token(flow_body, 33),
                ),
            )

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "ctx", self._fake_ctx(calls)
            ), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon.time, "monotonic", side_effect=lambda: clock[0]
            ):
                poc.tcp_message(flow)
                state = poc.flows[flow.id]
                poc.pending_command = PendingCommand("d" * 32, "computed", clock[0])
                poc._maybe_dispatch()
                attempt = poc.attempt
                assert attempt is not None
                initial_deadline = attempt.response_deadline
                self.assertEqual(
                    initial_deadline,
                    clock[0] + addon.PRODUCT_UNOBSERVED_RESPONSE_TIMEOUT_SECONDS,
                )

                clock[0] += 10.5
                flow.messages.append(
                    types.SimpleNamespace(from_client=True, content=calls[0][3])
                )
                poc.tcp_message(flow)

                self.assertEqual(attempt.dispatch_observed_at, clock[0])
                self.assertEqual(attempt.dispatch_observation_source, "injected_frame")
                self.assertEqual(
                    attempt.response_deadline,
                    clock[0] + addon.PRODUCT_RESPONSE_TIMEOUT_SECONDS,
                )
                self.assertNotEqual(attempt.response_deadline, initial_deadline)

                clock[0] = attempt.response_deadline - 0.1
                poc._check_attempt_deadlines()
                self.assertFalse(attempt.timed_out)

                clock[0] = attempt.response_deadline
                poc._check_attempt_deadlines()
                result = read_json(
                    state_dir / result_file_for_command(attempt.command_id)
                )

            self.assertTrue(attempt.timed_out)
            self.assertEqual(result and result.get("status"), "timeout")
            self.assertEqual(
                result and result.get("dispatchObservation"),
                "injected_frame",
            )
            self.assertIs(result and result.get("firstServerPayloadSeen"), False)
            self.assertEqual(result and result.get("failureStage"), "awaiting_response")
            self.assertEqual(
                result and result.get("responseTimeoutMs"),
                round(addon.PRODUCT_RESPONSE_TIMEOUT_SECONDS * 1000),
            )

    def test_product_response_timeout_falls_back_to_same_flow_activity(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-response-fallback-") as temporary:
            state_dir = Path(temporary)
            calls: list[tuple[object, ...]] = []
            clock = [100.0]
            poc = SatanicZoneRelayAddon()
            flow_body = authenticated_api_body()
            flow = self._flow(
                "delayed-injection-fallback-flow",
                build_frame(
                    flow_body,
                    computed_request_token(flow_body, 33),
                ),
            )

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "ctx", self._fake_ctx(calls)
            ), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "PRODUCT_PARENT_PID", os.getpid()
            ), patch.object(
                addon.time, "monotonic", side_effect=lambda: clock[0]
            ):
                poc.tcp_message(flow)
                poc.pending_command = PendingCommand("c" * 32, "computed", clock[0])
                poc._maybe_dispatch()
                attempt = poc.attempt
                assert attempt is not None
                initial_deadline = attempt.response_deadline
                self.assertEqual(
                    initial_deadline,
                    clock[0] + addon.PRODUCT_UNOBSERVED_RESPONSE_TIMEOUT_SECONDS,
                )

                clock[0] += 10.5
                flow.messages.append(
                    types.SimpleNamespace(from_client=False, content=GENERIC_RESPONSE)
                )
                poc.tcp_message(flow)

                self.assertEqual(attempt.dispatch_observed_at, clock[0])
                self.assertEqual(
                    attempt.dispatch_observation_source,
                    "same_flow_activity",
                )
                self.assertEqual(
                    attempt.response_deadline,
                    clock[0] + addon.PRODUCT_RESPONSE_TIMEOUT_SECONDS,
                )
                self.assertNotEqual(attempt.response_deadline, initial_deadline)

                clock[0] = attempt.response_deadline - 0.1
                poc._check_attempt_deadlines()

            self.assertFalse(attempt.timed_out)

    def test_product_publishes_each_sanitized_passive_zone_observation(self) -> None:
        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-observation-") as temporary:
            state_dir = Path(temporary)
            poc = SatanicZoneRelayAddon()
            flow = self._flow("passive-zone-flow", b"")
            state = TrackedFlow(flow, "203.0.113.8", 6669)
            completed_at = "2026-08-24T12:34:56Z"

            with patch.object(addon, "STATE_DIR", state_dir), patch.object(
                addon, "PRODUCT_RELAY_MODE", True
            ), patch.object(
                addon, "PRODUCT_SESSION_ID", "a" * 32
            ), patch.object(
                addon, "PRODUCT_SESSION_VALID", True
            ), patch.object(
                addon, "utc_now", return_value=completed_at
            ), patch.object(
                addon.secrets,
                "token_hex",
                side_effect=["1" * 32, "2" * 32],
            ):
                split = len(ZONE_RESPONSE) // 2
                poc._observe_server_payload(state, ZONE_RESPONSE[:split])
                self.assertFalse(
                    (state_dir / addon.PRODUCT_OBSERVATION_FILE).exists()
                )
                poc._observe_server_payload(state, ZONE_RESPONSE[split:])
                first = read_json(
                    state_dir / addon.PRODUCT_OBSERVATION_FILE
                )
                poc._observe_server_payload(state, GENERIC_RESPONSE)
                unchanged = read_json(
                    state_dir / addon.PRODUCT_OBSERVATION_FILE
                )
                poc._observe_server_payload(state, ZONE_RESPONSE)
                second = read_json(
                    state_dir / addon.PRODUCT_OBSERVATION_FILE
                )

            self.assertEqual(
                first,
                {
                    "schemaVersion": 1,
                    "sessionId": "a" * 32,
                    "observationId": "1" * 32,
                    "completedAt": completed_at,
                    "zoneObservation": {
                        "schemaVersion": 1,
                        "rawZone": "Test",
                        "buffs": [1],
                        "debuffs": [2],
                        "observedAt": completed_at,
                    },
                },
            )
            self.assertEqual(unchanged, first)
            self.assertEqual(second and second.get("observationId"), "2" * 32)

    def _establish_flow_local_scope(
        self,
        poc: SatanicZoneProxyPoc,
        clock: list[float],
        target_start_counter: int,
    ) -> tuple[object, TrackedFlow, object]:
        target_discovery_body = authenticated_api_body()
        target = self._flow(
            "target-local-flow",
            build_frame(
                target_discovery_body,
                computed_request_token(
                    target_discovery_body,
                    (target_start_counter - 1) % 256,
                ),
            ),
            remote_port=6669,
        )
        other_body = b"other-flow-initial"
        other = self._flow(
            "other-local-flow",
            build_frame(other_body, computed_request_token(other_body, 180)),
            remote_port=7447,
        )
        poc.tcp_message(target)
        target_state = poc.flows[target.id]
        poc.tcp_message(other)
        other_state = poc.flows[other.id]
        for state in (target_state, other_state):
            state.last_client_at = clock[0] - addon.SCOPE_QUIESCENCE_SECONDS - 0.1
        poc._maybe_start_counter_scope_epoch()
        if not poc.counter_scope.epoch_active:
            raise AssertionError("counter-scope clean epoch did not start")

        target_sz = build_frame(
            request_body(),
            computed_request_token(request_body(), target_start_counter),
        )
        target.messages.append(
            types.SimpleNamespace(from_client=True, content=target_sz)
        )
        poc.tcp_message(target)
        poc._observe_server_payload(target_state, ZONE_RESPONSE)
        for step in range(1, 4):
            clock[0] += 0.6
            other_counter = 179 + step
            other_step_body = f"other-flow-{step}".encode("ascii")
            other_frame = build_frame(
                other_step_body,
                computed_request_token(other_step_body, other_counter),
            )
            other.messages.append(
                types.SimpleNamespace(from_client=True, content=other_frame)
            )
            poc.tcp_message(other)
            clock[0] += 0.6
            target_body = f"target-api-{step}".encode("ascii")
            target_frame = build_frame(
                target_body,
                computed_request_token(target_body, (target_start_counter + step) % 256),
            )
            target.messages.append(
                types.SimpleNamespace(from_client=True, content=target_frame)
            )
            poc.tcp_message(target)
        target_state.last_client_at = (
            clock[0] - addon.SCOPE_QUIESCENCE_SECONDS - 1
        )
        target_state.last_server_at = clock[0] - addon.SERVER_IDLE_SECONDS - 1
        other_state.last_client_at = (
            clock[0] - addon.SCOPE_QUIESCENCE_SECONDS - 1
        )
        if not addon.PRODUCT_RELAY_MODE:
            (addon.STATE_DIR / "wire-session.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "status": "active",
                        "sessionId": addon.WIRE_SESSION_ID,
                        "pid": os.getpid(),
                        "ports": sorted(addon.WIRE_CONFIRMATION_PORTS),
                    }
                ),
                encoding="utf-8",
            )
        return target, target_state, other

    def _fill_scope_epoch_to_capacity(
        self,
        poc: SatanicZoneProxyPoc,
        other: object,
        other_start_counter: int,
    ) -> None:
        arm = poc.dispatch_arm
        if arm is None:
            raise AssertionError("dispatch arm was not established")
        observed = int(arm.scope_evidence["shuffleObservationCount"])
        remaining = MAX_GLOBAL_SHUFFLE_OBSERVATIONS - observed
        if remaining <= 0:
            raise AssertionError("proof epoch has no capacity to fill")
        for step in range(1, remaining + 1):
            body = f"capacity-other-{step}".encode("ascii")
            counter = (other_start_counter + step) % 256
            other.messages.append(
                types.SimpleNamespace(
                    from_client=True,
                    content=build_frame(body, computed_request_token(body, counter)),
                )
            )
            poc.tcp_message(other)
        evidence = poc.counter_scope.evidence(
            arm.flow_id,
            time.monotonic(),
            addon.COUNTER_SYNC_MAX_AGE_SECONDS,
        )
        self.assertEqual(
            evidence.shuffle_observation_count,
            MAX_GLOBAL_SHUFFLE_OBSERVATIONS,
        )

    @staticmethod
    def _fake_ctx(calls: list[tuple[object, ...]]) -> object:
        return types.SimpleNamespace(
            master=types.SimpleNamespace(
                commands=types.SimpleNamespace(call=lambda *args: calls.append(args))
            )
        )

    @staticmethod
    def _flow(flow_id: str, content: bytes, *, remote_port: int = 6669) -> object:
        return types.SimpleNamespace(
            id=flow_id,
            live=True,
            messages=[types.SimpleNamespace(from_client=True, content=content)],
            server_conn=types.SimpleNamespace(
                address=("203.0.113.8", remote_port),
                peername=None,
            ),
        )


@unittest.skipUnless(find_mitmdump(), "mitmdump is not installed")
class MitmproxyIntegrationTests(unittest.TestCase):
    def test_product_relay_two_injections_cooldown_and_reconnect_reset(self) -> None:
        mitmdump = find_mitmdump()
        assert mitmdump is not None
        upstream_port = reserve_port()
        proxy_port = reserve_port()
        while proxy_port == upstream_port:
            proxy_port = reserve_port()

        server = FakeTcpServer(upstream_port)
        server.start()
        process: subprocess.Popen[str] | None = None
        target_client: socket.socket | None = None
        other_client: socket.socket | None = None
        reconnect_client: socket.socket | None = None

        with tempfile.TemporaryDirectory(prefix="hsc-sz-product-") as temporary:
            state_dir = Path(temporary)
            session_id = "abcdefabcdefabcdefabcdefabcdefab"
            environment = os.environ.copy()
            environment.update(
                {
                    "HSC_SZ_RELAY_STATE_DIR": str(state_dir),
                    "HSC_SZ_RELAY_SESSION_ID": session_id,
                    "HSC_SZ_RELAY_COMMAND_COOLDOWN_MS": "30000",
                    "HSC_SZ_RELAY_PARENT_PID": str(os.getpid()),
                    "HSC_SZ_POC_MODE": "product",
                    "HSC_SZ_POC_WIRE_CONFIRMATION": "0",
                    "HSC_SZ_POC_IDLE_SECONDS": "0.05",
                    "HSC_SZ_POC_COMMAND_WAIT_SECONDS": "3",
                    "HSC_SZ_POC_COUNTER_SYNC_MAX_AGE_SECONDS": "10",
                    "HSC_SZ_POC_SERVER_IDLE_SECONDS": "0.05",
                    "HSC_SZ_POC_RESPONSE_TIMEOUT_SECONDS": "2",
                    "HSC_SZ_POC_STABLE_SECONDS": "1",
                    "PYTHONUNBUFFERED": "1",
                }
            )
            command = [
                mitmdump,
                "--mode",
                f"reverse:tcp://127.0.0.1:{upstream_port}@{proxy_port}",
                "--listen-host",
                "127.0.0.1",
                "--flow-detail",
                "0",
                "--quiet",
                "-s",
                str(RESOURCE_RELAY_DIR / "addon.py"),
            ]
            try:
                process = subprocess.Popen(
                    command,
                    cwd=RESOURCE_RELAY_DIR,
                    env=environment,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                )
                self.assertTrue(
                    wait_until(lambda: (state_dir / READY_FILE).exists()),
                    self._process_output(process, expected_state_file=READY_FILE),
                )
                ready = read_json(state_dir / READY_FILE)
                self.assertEqual(
                    set(ready or {}),
                    {
                        "schemaVersion",
                        "status",
                        "sessionId",
                        "pid",
                        "startedAt",
                        "repeatableRefresh",
                        "counterTranslation",
                        "parentLiveness",
                        "commandCooldownMs",
                        "requestSeeded",
                        "requestReady",
                    },
                )
                self.assertEqual(ready and ready.get("status"), "ready")
                self.assertEqual(ready and ready.get("sessionId"), session_id)
                self.assertEqual(ready and ready.get("commandCooldownMs"), 30_000)
                self.assertIs(ready and ready.get("parentLiveness"), True)
                self.assertIs(ready and ready.get("requestSeeded"), False)
                self.assertIs(ready and ready.get("requestReady"), False)

                target_client = self._connect(proxy_port)
                other_client = self._connect(proxy_port)
                target_discovery_body = authenticated_api_body(
                    b"mailbox/product-target-discovery"
                )
                target_discovery = build_frame(
                    target_discovery_body,
                    computed_request_token(target_discovery_body, 9),
                )
                other_discovery = unique_generic_frame(
                    "product-other-discovery",
                    99,
                )
                target_client.sendall(target_discovery)
                self.assertEqual(target_client.recv(4096), GENERIC_RESPONSE)
                other_client.sendall(other_discovery)
                self.assertEqual(other_client.recv(4096), GENERIC_RESPONSE)
                time.sleep(0.7)

                original = build_frame(
                    request_body(),
                    computed_request_token(request_body(), 10),
                )
                target_client.sendall(original)
                self.assertEqual(target_client.recv(4096), ZONE_RESPONSE)
                for step in range(1, 4):
                    time.sleep(0.6)
                    other_client.sendall(
                        unique_generic_frame(
                            f"product-other-guard-{step}",
                            99 + step,
                        )
                    )
                    self.assertEqual(other_client.recv(4096), GENERIC_RESPONSE)
                    time.sleep(0.6)
                    target_body = f"product-target-guard-{step}".encode("ascii")
                    target_client.sendall(
                        build_frame(
                            target_body,
                            computed_request_token(target_body, 10 + step),
                        )
                    )
                    self.assertEqual(target_client.recv(4096), GENERIC_RESPONSE)
                time.sleep(0.7)
                self.assertTrue(
                    wait_until(
                        lambda: (read_json(state_dir / READY_FILE) or {}).get(
                            "requestReady"
                        )
                        is True,
                        timeout=3,
                    ),
                    self._process_output(process, expected_state_file=READY_FILE),
                )

                first_id = "1" * 32
                self._queue_product_command(state_dir, session_id, first_id)
                self.assertTrue(
                    wait_until(
                        lambda: (read_json(state_dir / READY_FILE) or {}).get(
                            "requestReady"
                        )
                        is False,
                        timeout=3,
                    ),
                    self._process_output(process, expected_state_file=READY_FILE),
                )
                first_anchor_body = b"product-first-dispatch-anchor"
                target_client.sendall(
                    build_frame(
                        first_anchor_body,
                        computed_request_token(first_anchor_body, 14),
                    )
                )
                first_responses = self._recv_until_contains(
                    target_client,
                    GENERIC_RESPONSE,
                    ZONE_RESPONSE,
                )
                self.assertIn(GENERIC_RESPONSE, first_responses)
                self.assertIn(ZONE_RESPONSE, first_responses)
                first_result_path = state_dir / result_file_for_command(first_id)
                self.assertTrue(
                    wait_until(
                        lambda: (read_json(first_result_path) or {}).get("status")
                        == "success",
                        timeout=5,
                    ),
                    self._process_output(process, expected_state_file=first_result_path.name),
                )
                self.assertIs(
                    (read_json(state_dir / READY_FILE) or {}).get("requestReady"),
                    False,
                )

                cooldown_id = "2" * 32
                self._queue_product_command(state_dir, session_id, cooldown_id)
                cooldown_path = state_dir / result_file_for_command(cooldown_id)
                self.assertFalse(
                    wait_until(lambda: cooldown_path.exists(), timeout=1),
                    "A valid command inside relay cooldown should queue, not reject immediately.",
                )

                # Keep the flow-local source counter proof fresh near the end
                # of the mandatory 30-second helper cooldown.
                time.sleep(26.0)
                self.assertTrue(
                    wait_until(lambda: cooldown_path.exists(), timeout=3),
                    self._process_output(process, expected_state_file=cooldown_path.name),
                )
                self.assertEqual(
                    (read_json(cooldown_path) or {}).get("status"),
                    "timeout",
                )
                for step, native_counter in enumerate((15, 16, 17, 18), start=1):
                    time.sleep(0.6)
                    other_client.sendall(
                        unique_generic_frame(
                            f"product-other-cooldown-{step}",
                            102 + step,
                        )
                    )
                    self.assertEqual(other_client.recv(4096), GENERIC_RESPONSE)
                    time.sleep(0.6)
                    native_body = f"product-native-cooldown-{native_counter}".encode(
                        "ascii"
                    )
                    target_client.sendall(
                        build_frame(
                            native_body,
                            computed_request_token(native_body, native_counter),
                        )
                    )
                    self.assertEqual(target_client.recv(4096), GENERIC_RESPONSE)
                time.sleep(0.7)
                self.assertTrue(
                    wait_until(
                        lambda: (read_json(state_dir / READY_FILE) or {}).get(
                            "requestReady"
                        )
                        is True,
                        timeout=3,
                    ),
                    self._process_output(process, expected_state_file=READY_FILE),
                )

                second_id = "3" * 32
                self._queue_product_command(state_dir, session_id, second_id)
                time.sleep(0.3)
                second_anchor_body = b"product-second-dispatch-anchor"
                target_client.sendall(
                    build_frame(
                        second_anchor_body,
                        computed_request_token(second_anchor_body, 19),
                    )
                )
                second_responses = self._recv_until_contains(
                    target_client,
                    GENERIC_RESPONSE,
                    ZONE_RESPONSE,
                )
                self.assertIn(GENERIC_RESPONSE, second_responses)
                self.assertIn(ZONE_RESPONSE, second_responses)
                second_result_path = state_dir / result_file_for_command(second_id)
                self.assertTrue(
                    wait_until(
                        lambda: (read_json(second_result_path) or {}).get("status")
                        == "success",
                        timeout=5,
                    ),
                    self._process_output(process, expected_state_file=second_result_path.name),
                )

                final_native_body = b"product-native-after-second-injection"
                final_native = build_frame(
                    final_native_body,
                    computed_request_token(final_native_body, 20),
                )
                target_client.sendall(final_native)
                self.assertEqual(target_client.recv(4096), GENERIC_RESPONSE)
                target_client.close()
                target_client = None
                self.assertTrue(
                    wait_until(
                        lambda: (read_json(state_dir / READY_FILE) or {}).get(
                            "requestReady"
                        )
                        is False,
                        timeout=3,
                    ),
                    self._process_output(process, expected_state_file=READY_FILE),
                )

                reconnect_client = self._connect(proxy_port)
                reconnect_body = b"product-reconnect-fresh-counter"
                reconnect_frame = build_frame(
                    reconnect_body,
                    computed_request_token(reconnect_body, 40),
                )
                reconnect_client.sendall(reconnect_frame)
                self.assertEqual(reconnect_client.recv(4096), GENERIC_RESPONSE)
                self.assertTrue(wait_until(lambda: len(server.flow_frames) >= 3))

                with server.lock:
                    target_flow_number = next(
                        flow_number
                        for flow_number, frames in server.flow_frames.items()
                        if frames and frames[0] == target_discovery
                    )
                    reconnect_flow_number = next(
                        flow_number
                        for flow_number, frames in server.flow_frames.items()
                        if frames and frames[0] == reconnect_frame
                    )
                    target_frames = list(server.flow_frames[target_flow_number])
                    target_validations = list(
                        server.flow_sequence_validations[target_flow_number]
                    )
                    reconnect_frames = list(server.flow_frames[reconnect_flow_number])
                    reconnect_validations = list(
                        server.flow_sequence_validations[reconnect_flow_number]
                    )
                target_counters = [recover_frame_counter(frame) for frame in target_frames]
                self.assertEqual(target_counters, list(range(9, 23)))
                self.assertEqual(target_validations, [True] * len(target_validations))
                self.assertEqual(recover_frame_counter(reconnect_frames[0]), 40)
                self.assertEqual(reconnect_validations, [True])
                self.assertFalse(server.duplicate_counter_seen)

                allowed_files = {
                    READY_FILE,
                    addon.PRODUCT_OBSERVATION_FILE,
                    result_file_for_command(first_id),
                    result_file_for_command(cooldown_id),
                    result_file_for_command(second_id),
                }
                self.assertEqual(
                    {
                        path.name
                        for path in state_dir.iterdir()
                        if path.is_file()
                    },
                    allowed_files,
                )
                for result_path in (first_result_path, cooldown_path, second_result_path):
                    serialized = result_path.read_text(encoding="utf-8").lower()
                    for forbidden in (
                        "token",
                        "body",
                        "account",
                        "endpoint",
                        "remoteaddress",
                        "remoteport",
                        "flowid",
                        "sha256",
                        "scopeevidence",
                        "selectedscope",
                    ):
                        self.assertNotIn(forbidden, serialized)
                self.assertIsNone(server.error)
            finally:
                for client in (target_client, other_client, reconnect_client):
                    if client is not None:
                        try:
                            client.close()
                        except OSError:
                            pass
                if process is not None and process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                if process is not None and process.stdout is not None:
                    process.stdout.close()
                server.stop()

    def _connect(self, port: int) -> socket.socket:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            connection = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            connection.settimeout(3)
            try:
                connection.connect(("127.0.0.1", port))
                return connection
            except OSError:
                connection.close()
                time.sleep(0.05)
        self.fail("Could not connect to the local mitmdump reverse proxy.")

    @staticmethod
    def _queue_product_command(
        state_dir: Path,
        session_id: str,
        command_id: str,
    ) -> None:
        atomic_write_json(
            state_dir / "command.json",
            {
                "schemaVersion": 1,
                "command": "refresh_satanic_zone",
                "commandId": command_id,
                "sessionId": session_id,
                "requestedAt": utc_now(),
                "minimumDispatchSpacingMs": 30_000,
            },
        )

    def _recv_until_contains(self, connection: socket.socket, *needles: bytes) -> bytes:
        payload = b""
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not all(
            needle in payload for needle in needles
        ):
            payload += connection.recv(4096)
        self.assertTrue(
            all(needle in payload for needle in needles),
            f"Did not receive all expected response markers; byteLength={len(payload)}",
        )
        return payload

    def _process_output(
        self,
        process: subprocess.Popen[str],
        *,
        expected_state_file: str = "proxy.json",
    ) -> str:
        if process.poll() is None:
            return f"mitmdump did not create {expected_state_file} before the timeout"
        assert process.stdout is not None
        return process.stdout.read()


if __name__ == "__main__":
    unittest.main()
