import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import time
from typing import Any

from mitmproxy import ctx, tcp

from counter_translation import (
    CounterTranslationResult,
    OutboundApiCounterTranslator,
)
from counter_scope import INTERLEAVING_GUARD_SECONDS, CounterScopeTracker
from relay_state import (
    ARMED_FILE,
    COMMAND_FILE,
    CONSUMED_FILE,
    PROXY_FILE,
    READY_FILE,
    RESULT_FILE,
    WIRE_SESSION_FILE,
    append_event as append_state_event,
    atomic_write_json,
    process_is_alive,
    read_json,
    reserve_json_marker,
    result_file_for_command,
    utc_now,
)
from sz_frame import (
    FrameError,
    OutboundFrameStreamDecoder,
    ParsedFrame,
    UnaccountedOutboundBytes,
    build_computed_satanic_zone_request,
    build_frame,
    computed_request_token,
    frame_summary,
    matching_frame_counters,
    parse_frame,
    parsed_frame_summary,
    request_token_analysis,
    response_signals,
    sanitized_zone_observation,
)


SCRIPT_DIR = Path(__file__).resolve().parent
_EXPLICIT_POC_MODE = os.environ.get("HSC_SZ_POC_MODE")
_RELAY_SESSION_ENV = os.environ.get("HSC_SZ_RELAY_SESSION_ID", "").strip().lower()
POC_MODE = (
    "product"
    if _RELAY_SESSION_ENV
    else (
        _EXPLICIT_POC_MODE.strip().lower()
        if _EXPLICIT_POC_MODE is not None
        else "research"
    )
)
PRODUCT_RELAY_MODE = POC_MODE == "product"
STATE_DIR = Path(
    (
        os.environ.get("HSC_SZ_RELAY_STATE_DIR")
        or os.environ.get("HSC_SZ_POC_STATE_DIR")
        or SCRIPT_DIR / "state"
    )
    if PRODUCT_RELAY_MODE
    else (os.environ.get("HSC_SZ_POC_STATE_DIR") or SCRIPT_DIR / "state")
).resolve()
PRODUCT_SESSION_ID = (
    _RELAY_SESSION_ENV
    or os.environ.get("HSC_SZ_POC_SESSION_ID", "").strip().lower()
)
SESSION_ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")
PRODUCT_COMMAND_ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")
RESEARCH_COMMAND_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
PRODUCT_SESSION_VALID = bool(SESSION_ID_PATTERN.fullmatch(PRODUCT_SESSION_ID))
_PRODUCT_PARENT_PID_ENV = os.environ.get("HSC_SZ_RELAY_PARENT_PID", "").strip()
PRODUCT_PARENT_PID = (
    int(_PRODUCT_PARENT_PID_ENV)
    if re.fullmatch(r"[1-9][0-9]{0,9}", _PRODUCT_PARENT_PID_ENV)
    and int(_PRODUCT_PARENT_PID_ENV) <= 0xFFFFFFFF
    else None
)
WIRE_CONFIRMATION_ENABLED = os.environ.get("HSC_SZ_POC_WIRE_CONFIRMATION", "0") == "1"
WIRE_CONFIRMATION_PORTS = {
    int(value)
    for value in os.environ.get("HSC_SZ_POC_WIRE_PORTS", "6668,6669").split(",")
    if value.strip().isdigit()
}
WIRE_SESSION_ID = os.environ.get("HSC_SZ_POC_WIRE_SESSION_ID", "")
ALLOW_INJECTION = os.environ.get("HSC_SZ_POC_ALLOW_INJECTION", "0") == "1"
IDLE_SECONDS = max(float(os.environ.get("HSC_SZ_POC_IDLE_SECONDS", "0.5")), 0.0)
SCOPE_QUIESCENCE_SECONDS = max(IDLE_SECONDS, INTERLEAVING_GUARD_SECONDS)
COMMAND_WAIT_SECONDS = max(float(os.environ.get("HSC_SZ_POC_COMMAND_WAIT_SECONDS", "10")), 1.0)
# The controller has a bounded pre-dispatch watcher. Expire an undispatched
# command first so a click can never be sent after its caller has already
# settled; the server-response timeout begins only after actual dispatch.
PRODUCT_COMMAND_WAIT_SECONDS = 20.0
FRAME_MAX_AGE_SECONDS = max(float(os.environ.get("HSC_SZ_POC_FRAME_MAX_AGE_SECONDS", "1800")), 1.0)
COUNTER_SYNC_MAX_AGE_SECONDS = max(
    float(os.environ.get("HSC_SZ_POC_COUNTER_SYNC_MAX_AGE_SECONDS", "15")),
    1.0,
)
UAT_RELAX_TARGET_ANCHOR_SCOPE_RECHECK = (
    os.environ.get("HSC_SZ_POC_UAT_RELAX_TARGET_ANCHOR_SCOPE_RECHECK", "0") == "1"
)
TARGET_ANCHOR_SCOPE_POLICY = (
    "same_flow_api_context"
    if PRODUCT_RELAY_MODE
    else (
        "uat_relaxed_after_strict_preflight"
        if UAT_RELAX_TARGET_ANCHOR_SCOPE_RECHECK
        else "strict_recheck"
    )
)
UAT_RELAXED_TARGET_ANCHOR_MAX_AGE_SECONDS = 5.0
SERVER_IDLE_SECONDS = max(
    float(os.environ.get("HSC_SZ_POC_SERVER_IDLE_SECONDS", str(IDLE_SECONDS))),
    0.0,
)
RESPONSE_TIMEOUT_SECONDS = max(float(os.environ.get("HSC_SZ_POC_RESPONSE_TIMEOUT_SECONDS", "10")), 1.0)
# `inject.tcp` schedules delivery into mitmproxy's connection task. Product
# timing therefore allows that callback to arrive, then gives the backend a
# fresh response window. Tests may retain their short POC override; the managed
# runtime strips inherited HSC variables, so production receives this default.
PRODUCT_RESPONSE_TIMEOUT_SECONDS = max(
    float(
        os.environ.get(
            "HSC_SZ_RELAY_RESPONSE_TIMEOUT_SECONDS",
            os.environ.get("HSC_SZ_POC_RESPONSE_TIMEOUT_SECONDS", "14"),
        )
    ),
    1.0,
)
# Product dispatch has shown a scheduler-to-wire delay without any corresponding
# addon callback. Keep the initial deadline just inside the controller's 30 s
# wait; an exact injected-frame or same-flow callback still replaces it with the
# shorter backend-only response window above. Explicit POC timing overrides keep
# isolated integration tests fast.
_PRODUCT_UNOBSERVED_RESPONSE_TIMEOUT_DEFAULT = os.environ.get(
    "HSC_SZ_POC_RESPONSE_TIMEOUT_SECONDS",
    "29",
)
PRODUCT_UNOBSERVED_RESPONSE_TIMEOUT_SECONDS = max(
    float(
        os.environ.get(
            "HSC_SZ_RELAY_UNOBSERVED_RESPONSE_TIMEOUT_SECONDS",
            _PRODUCT_UNOBSERVED_RESPONSE_TIMEOUT_DEFAULT,
        )
    ),
    PRODUCT_RESPONSE_TIMEOUT_SECONDS,
)
STABLE_SECONDS = max(float(os.environ.get("HSC_SZ_POC_STABLE_SECONDS", "60")), 1.0)
_PRODUCT_COMMAND_COOLDOWN_MS = max(
    float(
        os.environ.get(
            "HSC_SZ_RELAY_COMMAND_COOLDOWN_MS",
            str(
                float(
                    os.environ.get(
                        "HSC_SZ_POC_PRODUCT_DISPATCH_INTERVAL_SECONDS",
                        "30",
                    )
                )
                * 1000
            ),
        )
    ),
    30_000.0,
)
PRODUCT_DISPATCH_INTERVAL_SECONDS = _PRODUCT_COMMAND_COOLDOWN_MS / 1000
PRODUCT_OBSERVATION_FILE = "observation.json"
AUTOMATIC_FLOW_RECYCLE_SUPPORTED = False
MAX_INJECTIONS = 1
MAX_RESPONSE_BUFFER = 64 * 1024
INJECTION_STRATEGIES = {"computed"}
# Match the current native API envelope observed on successful game-owned
# satanic_zone_get requests. The earlier two-NUL UAT template was two bytes
# shorter and reached the backend without producing a zone response.
PRODUCT_REQUEST_BODY_PREFIX = b"\x03\x00\x01\x00"
PRODUCT_REQUEST_ROUTE_MARKER = b"R\x00"
UNIQUE_ACCOUNT_ID_PATTERN = re.compile(
    rb"(?:^|[&\x00-\x20])unique_account_id=([0-9]{1,20})(?=$|[&\x00-\x20])"
)
CROSSREGION_IDENTIFIER_PATTERN = re.compile(
    rb"(?:^|[&\x00-\x20])crossregion_identifier=([0-9]{1,32})(?=$|[&\x00-\x20])"
)


def append_event(state_dir: Path, event: str, **data: Any) -> dict[str, Any]:
    """Keep rich reverse-engineering diagnostics out of managed product state."""
    if PRODUCT_RELAY_MODE:
        return {"event": event, "at": utc_now()}
    return append_state_event(state_dir, event, **data)


def _injection_allowed() -> bool:
    if PRODUCT_RELAY_MODE:
        # Selecting product relay mode with a valid per-launch session ID is the
        # explicit opt-in. Research mode retains its separate live-write gate.
        return PRODUCT_SESSION_VALID and PRODUCT_PARENT_PID is not None
    return ALLOW_INJECTION


def _command_id_valid(command_id: str) -> bool:
    pattern = (
        PRODUCT_COMMAND_ID_PATTERN
        if PRODUCT_RELAY_MODE
        else RESEARCH_COMMAND_ID_PATTERN
    )
    return bool(pattern.fullmatch(command_id))


@dataclass
class NormalRequestBaseline:
    request_id: str
    started_at: float
    response_buffer: bytearray = field(default_factory=bytearray)
    first_response_seen: bool = False
    zone_response_seen: bool = False
    zone_response_seen_at: float = 0.0


@dataclass
class PendingOffsetAdvance:
    command_id: str
    anchor_client_counter: int


@dataclass
class TrackedFlow:
    flow: tcp.TCPFlow
    remote_address: str
    remote_port: int
    decoder: OutboundFrameStreamDecoder = field(default_factory=OutboundFrameStreamDecoder)
    last_client_at: float = field(default_factory=time.monotonic)
    last_server_at: float = 0.0
    recent_server_payload: bytearray = field(default_factory=bytearray)
    passive_response_buffer: bytearray = field(default_factory=bytearray)
    previous_legitimate_token: bytes | None = None
    normal_request: NormalRequestBaseline | None = None
    observed_at: float = 0.0
    observed_wall_at: str = ""
    captured_frame: bytes | None = None
    unique_account_id: bytes | None = None
    crossregion_identifier: bytes | None = None
    last_api_counter: int | None = None
    last_api_observed_at: float = 0.0
    counter_translation: OutboundApiCounterTranslator | None = None
    pending_offset_advance: PendingOffsetAdvance | None = None
    relay_unusable_reason: str | None = None
    flow_recycle_requested: bool = False


@dataclass
class PendingCommand:
    command_id: str
    strategy: str
    received_at: float


@dataclass
class DispatchArm:
    command_id: str
    flow_id: str
    armed_at: float
    armed_wall_at: str
    selected_scope: str
    current_counter: int
    scope_evidence: dict[str, bool | int]
    baseline_request_id: str
    uses_translation_continuity: bool = False
    waiting_for_baseline_request_id: str | None = None


@dataclass(frozen=True)
class ClientFrameCounterObservation:
    verified: bool
    verified_api: bool
    current_counter: int | None
    flow_transition_checked: bool
    flow_transition_continuous: bool


@dataclass
class InjectionAttempt:
    command_id: str
    strategy: str
    flow_id: str
    started_at: float
    started_wall_at: str
    response_deadline: float
    stable_deadline: float
    response_timeout_seconds: float = RESPONSE_TIMEOUT_SECONDS
    dispatch_observed_at: float | None = None
    dispatch_observed_wall_at: str | None = None
    dispatch_observation_source: str | None = None
    response_buffer: bytearray = field(default_factory=bytearray)
    first_response_seen: bool = False
    first_server_payload_wall_at: str | None = None
    zone_response_seen: bool = False
    zone_response_at: float | None = None
    zone_response_wall_at: str | None = None
    zone_observation: dict[str, object] | None = None
    native_client_payload_seen: bool = False
    native_client_payload_at: float | None = None
    native_client_payload_wall_at: str | None = None
    native_client_flow_id: str | None = None
    native_client_remote_port: int | None = None
    timed_out: bool = False
    response_timeout_wall_at: str | None = None
    stable_logged: bool = False
    flow_closed: bool = False
    flow_closed_wall_at: str | None = None
    dispatch_outcome_uncertain: bool = False
    terminal_inconclusive: bool = False
    selected_scope: str = "unknown"
    scope_evidence: dict[str, bool | int] = field(default_factory=dict)
    target_anchor_scope_policy: str = "strict_recheck"
    target_anchor_scope_relaxation_used: bool = False
    other_flow_native_payload_seen: bool = False
    first_other_flow_native_payload_wall_at: str | None = None
    counter_translation_armed: bool = False
    counter_translation_applied: bool = False
    counter_translation_failed: bool = False
    counter_translation_failure_reason: str | None = None
    translated_native_api_frames: int = 0
    translated_native_generic_frames: int = 0
    counter_translation_withheld_bytes: int = 0
    settled: bool = False
    settled_wall_at: str | None = None


class SatanicZoneRelayAddon:
    def __init__(self) -> None:
        self.flows: dict[str, TrackedFlow] = {}
        self.pending_command: PendingCommand | None = None
        self.dispatch_arm: DispatchArm | None = None
        self.attempt: InjectionAttempt | None = None
        self.attempt_count = 0
        self.one_shot_consumed = (
            not PRODUCT_RELAY_MODE and (STATE_DIR / CONSUMED_FILE).exists()
        )
        self.counter_scope = CounterScopeTracker()
        self.armed_flow_id: str | None = None
        self.last_armed_status_refresh_at = 0.0
        self.injected_content_hashes: set[tuple[str, str]] = set()
        self.last_dispatch_at: float | None = None
        self.last_dispatch_wall_at: str | None = None
        self.next_dispatch_wall_at: str | None = None
        self.product_terminal_results_written: set[str] = set()
        self.product_started_wall_at: str | None = None
        self.product_request_ready: bool | None = None
        self.product_request_seeded: bool | None = None
        self.product_parent_shutdown_requested = False
        self.command_task: asyncio.Task[None] | None = None
        self.dispatch_retry_handle: asyncio.TimerHandle | None = None

    def running(self) -> None:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        self.one_shot_consumed = self.one_shot_consumed or (
            not PRODUCT_RELAY_MODE and (STATE_DIR / CONSUMED_FILE).exists()
        )
        if self.one_shot_consumed:
            self.attempt_count = MAX_INJECTIONS
        session_id = PRODUCT_SESSION_ID if PRODUCT_RELAY_MODE else WIRE_SESSION_ID
        started_at = utc_now()
        if PRODUCT_RELAY_MODE:
            self.product_started_wall_at = started_at
            (STATE_DIR / PRODUCT_OBSERVATION_FILE).unlink(missing_ok=True)
        proxy_state: dict[str, object] = {
            "schemaVersion": 2 if PRODUCT_RELAY_MODE else 1,
            "status": "running",
            "mode": "product" if PRODUCT_RELAY_MODE else "research_one_shot",
            "pid": os.getpid(),
            "startedAt": started_at,
            "allowInjection": _injection_allowed(),
            "trackedTcpScope": "all_process_tcp_flows",
            "sessionId": session_id,
            "scopeSelectionPolicy": "flow_local_only",
            "targetAnchorScopePolicy": TARGET_ANCHOR_SCOPE_POLICY,
            "scopeQuiescenceMs": round(SCOPE_QUIESCENCE_SECONDS * 1000),
            "recommendedInjectionStrategy": "computed",
            "oneShotConsumed": self.one_shot_consumed,
            "reusableSession": PRODUCT_RELAY_MODE,
            "minimumDispatchIntervalMs": round(
                PRODUCT_DISPATCH_INTERVAL_SECONDS * 1000
            ) if PRODUCT_RELAY_MODE else None,
            "automaticFlowRecycleSupported": AUTOMATIC_FLOW_RECYCLE_SUPPORTED,
        }
        if not PRODUCT_RELAY_MODE:
            proxy_state.update(
                {
                    "wireConfirmationEnabled": WIRE_CONFIRMATION_ENABLED,
                    "wireConfirmationPorts": sorted(WIRE_CONFIRMATION_PORTS),
                    "wireSessionConfigured": bool(WIRE_SESSION_ID),
                }
            )
        if not PRODUCT_RELAY_MODE:
            atomic_write_json(
                STATE_DIR / PROXY_FILE,
                proxy_state,
            )
        if PRODUCT_RELAY_MODE:
            self._write_product_ready_state(time.monotonic(), request_ready=False)
        append_event(
            STATE_DIR,
            "proxy_started",
            pid=os.getpid(),
            mode="product" if PRODUCT_RELAY_MODE else "research_one_shot",
            allowInjection=_injection_allowed(),
            trackedTcpScope="all_process_tcp_flows",
            wireConfirmationEnabled=WIRE_CONFIRMATION_ENABLED,
            wireConfirmationPorts=sorted(WIRE_CONFIRMATION_PORTS),
            wireSessionConfigured=bool(WIRE_SESSION_ID),
            scopeSelectionPolicy="flow_local_only",
            targetAnchorScopePolicy=TARGET_ANCHOR_SCOPE_POLICY,
            scopeQuiescenceMs=round(SCOPE_QUIESCENCE_SECONDS * 1000),
            oneShotConsumed=self.one_shot_consumed,
            reusableSession=PRODUCT_RELAY_MODE,
            productSessionValid=(PRODUCT_SESSION_VALID if PRODUCT_RELAY_MODE else None),
            automaticFlowRecycleSupported=AUTOMATIC_FLOW_RECYCLE_SUPPORTED,
        )
        self.command_task = asyncio.create_task(self._command_loop())

    def done(self) -> None:
        if self.command_task is not None:
            self.command_task.cancel()
        self._cancel_dispatch_retry()
        if PRODUCT_RELAY_MODE:
            (STATE_DIR / READY_FILE).unlink(missing_ok=True)
        else:
            (STATE_DIR / PROXY_FILE).unlink(missing_ok=True)
        append_event(STATE_DIR, "proxy_stopped", attempts=self.attempt_count)

    def tcp_start(self, flow: tcp.TCPFlow) -> None:
        self._ensure_flow(flow)
        self._write_product_ready_state(time.monotonic())
        self._retry_pending_dispatch_from_event()

    def tcp_message(self, flow: tcp.TCPFlow) -> None:
        state = self._ensure_flow(flow)
        if state is None or not flow.messages:
            return
        message = flow.messages[-1]
        content = bytes(message.content)
        if message.from_client:
            state.last_client_at = time.monotonic()
            content_hash = _sha256(content)
            injected_key = (flow.id, content_hash)
            if injected_key in self.injected_content_hashes:
                self.injected_content_hashes.discard(injected_key)
                self._observe_injected_frame_dispatch(state)
                append_event(
                    STATE_DIR,
                    "injected_frame_observed_by_proxy",
                    flowId=_safe_flow_id(flow.id),
                    sha256=content_hash,
                    byteLength=len(content),
                )
                return
            self._observe_post_reservation_flow_activity(state)
            active_translation = state.counter_translation
            self._observe_client_payload_after_injection(state, content)
            verified_target_api_seen = False
            relaxed_anchor_frames_continuous = True
            decoded_frame_count = 0
            verified_frame_counters: list[int] = []
            all_callback_frames_verified = True
            last_frame_observation: ClientFrameCounterObservation | None = None
            decoded_items = state.decoder.feed(content)
            for decoded in decoded_items:
                if isinstance(decoded, UnaccountedOutboundBytes):
                    relaxed_anchor_frames_continuous = False
                    verified_frame_counters.clear()
                    all_callback_frames_verified = False
                    last_frame_observation = None
                    self.counter_scope.invalidate(flow.id)
                    if PRODUCT_RELAY_MODE:
                        # These bytes may have contained an API request whose
                        # counter the relay could not account for. Keep the
                        # in-memory identity, but require the next uniquely
                        # verified API frame before product dispatch.
                        state.last_api_counter = None
                        state.last_api_observed_at = 0.0
                        self._defer_dispatch_arm(
                            state,
                            "target_stream_bytes_unaccounted",
                        )
                    else:
                        self._disarm_flow(
                            state,
                            "target_stream_bytes_unaccounted",
                        )
                    append_event(
                        STATE_DIR,
                        "client_outbound_stream_bytes_unaccounted",
                        flowId=_safe_flow_id(flow.id),
                        byteLength=decoded.byte_length,
                        scopeModelTainted=True,
                    )
                    self._refresh_latest_armed_state(time.monotonic(), force=True)
                else:
                    frame_observation = self._observe_client_outbound_frame(state, decoded)
                    decoded_frame_count += 1
                    if (
                        all_callback_frames_verified
                        and frame_observation.verified
                        and frame_observation.current_counter is not None
                        and len(verified_frame_counters) == decoded_frame_count - 1
                    ):
                        verified_frame_counters.append(
                            frame_observation.current_counter
                        )
                    else:
                        verified_frame_counters.clear()
                        all_callback_frames_verified = False
                    verified_target_api_seen = (
                        frame_observation.verified_api or verified_target_api_seen
                    )
                    relaxed_anchor_frames_continuous = (
                        relaxed_anchor_frames_continuous
                        and frame_observation.verified
                        and frame_observation.flow_transition_checked
                        and frame_observation.flow_transition_continuous
                    )
                    last_frame_observation = frame_observation
            dispatch_arm = self.dispatch_arm
            if dispatch_arm is not None and dispatch_arm.flow_id == flow.id:
                self._maybe_dispatch_after_target_callback(
                    state,
                    verified_target_api_seen=verified_target_api_seen,
                    relaxed_anchor_frames_continuous=(
                        relaxed_anchor_frames_continuous
                    ),
                    decoded_frame_count=decoded_frame_count,
                    anchor_counter=(
                        last_frame_observation.current_counter
                        if last_frame_observation is not None
                        and last_frame_observation.verified_api
                        else None
                    ),
                    verified_frame_counters=tuple(verified_frame_counters),
                )
            if active_translation is not None:
                translation_result = self._translate_client_content(
                    state,
                    message,
                    content,
                    active_translation,
                )
                self._commit_pending_offset_advance(
                    state,
                    active_translation,
                    translation_result,
                )
        else:
            self._observe_post_reservation_flow_activity(state)
            self._observe_server_payload(state, content)
        self._retry_pending_dispatch_from_event()

    def tcp_end(self, flow: tcp.TCPFlow) -> None:
        self._close_flow(flow, "tcp_end")

    def tcp_error(self, flow: tcp.TCPFlow) -> None:
        error = str(flow.error or "unknown TCP error")[:200]
        self._close_flow(flow, "tcp_error", error=error)

    def _ensure_flow(self, flow: tcp.TCPFlow) -> TrackedFlow | None:
        existing = self.flows.get(flow.id)
        if existing is not None:
            if existing.flow is not flow:
                self._close_flow(existing.flow, "tcp_flow_replaced")
                existing = None
        if existing is not None:
            endpoint = _server_endpoint(flow)
            if endpoint is not None and existing.remote_port == 0:
                existing.remote_address, existing.remote_port = endpoint
            return existing
        endpoint = _server_endpoint(flow)
        if endpoint is None:
            endpoint = ("unknown", 0)
        state = TrackedFlow(flow=flow, remote_address=endpoint[0], remote_port=endpoint[1])
        self.flows[flow.id] = state
        append_event(
            STATE_DIR,
            "tcp_flow_started",
            flowId=_safe_flow_id(flow.id),
            remoteAddress=state.remote_address,
            remotePort=state.remote_port,
        )
        return state

    def _observe_client_outbound_frame(
        self,
        state: TrackedFlow,
        parsed: ParsedFrame,
    ) -> ClientFrameCounterObservation:
        observed_at = time.monotonic()
        matching_counters = matching_frame_counters(parsed)
        observation = self.counter_scope.observe(
            state.flow.id,
            parsed.framing,
            matching_counters,
            observed_at,
        )
        summary = parsed_frame_summary(parsed)
        flow_id = _safe_flow_id(state.flow.id)
        evidence = self.counter_scope.evidence(
            state.flow.id,
            observed_at,
            COUNTER_SYNC_MAX_AGE_SECONDS,
        ).persistable()
        current_counter = (
            matching_counters[0]
            if observation.verified and len(matching_counters) == 1
            else None
        )
        if PRODUCT_RELAY_MODE and parsed.framing == "api":
            if current_counter is None:
                # An API request was observed but its exact counter was not.
                # The previous value is no longer a safe dispatch anchor.
                state.last_api_counter = None
                state.last_api_observed_at = 0.0
            else:
                identity = _authenticated_identity_from_api_body(parsed.body)
                if identity is not None and not parsed.is_satanic_zone_request:
                    state.unique_account_id, state.crossregion_identifier = identity
                if (
                    state.unique_account_id is not None
                    and state.crossregion_identifier is not None
                ):
                    state.last_api_counter = current_counter
                    state.last_api_observed_at = observed_at
                    self.armed_flow_id = state.flow.id
        if not observation.verified:
            if PRODUCT_RELAY_MODE:
                self._defer_dispatch_arm(
                    state,
                    "target_frame_counter_unverified",
                )
            else:
                self._disarm_flow(state, "target_frame_counter_unverified")
            append_event(
                STATE_DIR,
                "client_outbound_frame_counter_unverified",
                flowId=flow_id,
                byteLength=summary["byteLength"],
                sha256=summary["sha256"],
                framing=summary["framing"],
                routeMatched=summary["routeMatched"],
                counterVerified=False,
                candidateSetAccounted=observation.candidate_set_accounted,
                counterCandidateUnique=len(matching_counters) == 1,
                cleanEpochActive=observation.clean_epoch_active,
                scopeEvidence=evidence,
            )
        else:
            if (
                observation.flow_transition_checked
                and not observation.flow_transition_continuous
            ):
                if PRODUCT_RELAY_MODE:
                    self._defer_dispatch_arm(
                        state,
                        "target_counter_sequence_reset",
                    )
                else:
                    self._disarm_flow(state, "target_counter_sequence_reset")
            append_event(
                STATE_DIR,
                "client_outbound_frame_counter_verified",
                flowId=flow_id,
                byteLength=summary["byteLength"],
                sha256=summary["sha256"],
                framing=summary["framing"],
                routeMatched=summary["routeMatched"],
                counterVerified=True,
                globalSequenceContinuityChecked=observation.global_transition_checked,
                globalSequenceContinuous=observation.global_transition_continuous,
                flowSequenceContinuityChecked=observation.flow_transition_checked,
                flowSequenceContinuous=observation.flow_transition_continuous,
                guardedOtherFlowFramesPresent=(
                    observation.interleaving_frames_within_bounds
                ),
                cleanEpochActive=observation.clean_epoch_active,
                scopeEvidence=evidence,
            )
        if (
            not PRODUCT_RELAY_MODE
            and parsed.is_satanic_zone_request
            and observation.verified
        ):
            self._arm_flow(state, parsed.raw)
        self._refresh_latest_armed_state(observed_at, force=True)
        return ClientFrameCounterObservation(
            verified=observation.verified,
            verified_api=observation.verified and parsed.framing == "api",
            current_counter=current_counter,
            flow_transition_checked=observation.flow_transition_checked,
            flow_transition_continuous=observation.flow_transition_continuous,
        )

    def _arm_flow(self, state: TrackedFlow, frame: bytes) -> None:
        dispatch_arm = self.dispatch_arm
        if dispatch_arm is not None and dispatch_arm.flow_id != state.flow.id:
            self._reject_pending("armed_target_changed_before_anchor")
        previous_armed_flow_id = self.armed_flow_id
        if (
            previous_armed_flow_id is not None
            and previous_armed_flow_id != state.flow.id
        ):
            previous_state = self.flows.get(previous_armed_flow_id)
            if previous_state is not None:
                self._disarm_flow(previous_state, "armed_target_replaced")
        parsed = parse_frame(frame)
        token_analysis = request_token_analysis(
            frame,
            previous_token=state.previous_legitimate_token,
            prior_server_payload=bytes(state.recent_server_payload),
        )
        state.captured_frame = frame
        self.armed_flow_id = state.flow.id
        state.previous_legitimate_token = parsed.token
        state.observed_at = time.monotonic()
        state.observed_wall_at = utc_now()
        summary = frame_summary(frame)
        request_id = str(summary["tokenHash"])
        state.normal_request = NormalRequestBaseline(request_id=request_id, started_at=state.observed_at)
        flow_id = _safe_flow_id(state.flow.id)
        append_event(
            STATE_DIR,
            "satanic_zone_request_observed",
            flowId=flow_id,
            remoteAddress=state.remote_address,
            remotePort=state.remote_port,
            tokenAnalysis=token_analysis,
            **summary,
        )
        self._write_armed_state(state, state.observed_at)

    def _write_armed_state(self, state: TrackedFlow, now: float) -> None:
        if self.armed_flow_id != state.flow.id or state.captured_frame is None:
            return
        if PRODUCT_RELAY_MODE:
            self.last_armed_status_refresh_at = now
            self._write_product_ready_state(now)
            return
        summary = frame_summary(state.captured_frame)
        selection = self.counter_scope.select(
            state.flow.id,
            now,
            COUNTER_SYNC_MAX_AGE_SECONDS,
        )
        evidence = (
            selection.evidence
            if selection is not None
            else self.counter_scope.evidence(
                state.flow.id,
                now,
                COUNTER_SYNC_MAX_AGE_SECONDS,
            )
        )
        cooldown_ready = self._product_cooldown_ready(now)
        attempt_active = bool(self.attempt is not None and not self.attempt.settled)
        translation_healthy = bool(
            state.relay_unusable_reason is None
            and (
                state.counter_translation is None
                or not state.counter_translation.failed
            )
        )
        legitimate_response_seen = bool(
            state.normal_request and state.normal_request.zone_response_seen
        )
        armed_state: dict[str, object] = {
            "schemaVersion": 2 if PRODUCT_RELAY_MODE else 1,
            "status": "armed",
            "mode": "product" if PRODUCT_RELAY_MODE else "research_one_shot",
            "observedAt": state.observed_wall_at,
            "scopeEvaluatedAt": utc_now(),
            "scopeEvidenceMaxAgeSeconds": round(COUNTER_SYNC_MAX_AGE_SECONDS),
            "allowInjection": _injection_allowed(),
            "sessionId": (
                PRODUCT_SESSION_ID if PRODUCT_RELAY_MODE else WIRE_SESSION_ID
            ),
            "scopeSelectionPolicy": "flow_local_only",
            "targetAnchorScopePolicy": TARGET_ANCHOR_SCOPE_POLICY,
            "scopeQuiescenceMs": round(SCOPE_QUIESCENCE_SECONDS * 1000),
            "scopeReady": selection is not None,
            "selectedScope": selection.scope if selection is not None else None,
            "scopeEvidence": evidence.persistable(),
            "legitimateZoneResponseObserved": legitimate_response_seen,
        }
        if PRODUCT_RELAY_MODE:
            armed_state.update(
                {
                    "refreshReady": bool(
                        _injection_allowed()
                        and PRODUCT_SESSION_VALID
                        and selection is not None
                        and legitimate_response_seen
                        and not attempt_active
                        and self.pending_command is None
                        and self.dispatch_arm is None
                        and cooldown_ready
                        and translation_healthy
                    ),
                    "commandInFlight": bool(
                        attempt_active
                        or self.pending_command is not None
                        or self.dispatch_arm is not None
                    ),
                    "cooldownReady": cooldown_ready,
                    "minimumDispatchIntervalMs": round(
                        PRODUCT_DISPATCH_INTERVAL_SECONDS * 1000
                    ),
                    "lastDispatchAt": self.last_dispatch_wall_at,
                    "nextDispatchAt": self.next_dispatch_wall_at,
                    "translationActive": state.counter_translation is not None,
                    "translationHealthy": translation_healthy,
                    "flowRecycleRequired": state.relay_unusable_reason is not None,
                    "automaticFlowRecycleSupported": (
                        AUTOMATIC_FLOW_RECYCLE_SUPPORTED
                    ),
                }
            )
        else:
            armed_state.update(
                {
                    "flowId": _safe_flow_id(state.flow.id),
                    "remoteAddress": state.remote_address,
                    "remotePort": state.remote_port,
                    **summary,
                }
            )
        atomic_write_json(
            STATE_DIR / ARMED_FILE,
            armed_state,
        )
        self.last_armed_status_refresh_at = now

    def _write_product_ready_state(
        self,
        now: float,
        *,
        request_ready: bool | None = None,
    ) -> None:
        if not PRODUCT_RELAY_MODE or self.product_started_wall_at is None:
            return
        request_seeded = self._product_request_is_seeded()
        resolved_request_ready = (
            self._product_request_is_ready(now)
            if request_ready is None
            else request_ready
        )
        resolved_request_ready = bool(
            request_seeded and resolved_request_ready
        )
        if (
            self.product_request_seeded is request_seeded
            and self.product_request_ready is resolved_request_ready
        ):
            return
        atomic_write_json(
            STATE_DIR / READY_FILE,
            {
                "schemaVersion": 1,
                "status": "ready" if _injection_allowed() else "unavailable",
                "sessionId": PRODUCT_SESSION_ID,
                "pid": os.getpid(),
                "startedAt": self.product_started_wall_at,
                "repeatableRefresh": True,
                "counterTranslation": True,
                "parentLiveness": True,
                "commandCooldownMs": round(
                    PRODUCT_DISPATCH_INTERVAL_SECONDS * 1000
                ),
                "requestSeeded": request_seeded,
                "requestReady": resolved_request_ready,
            },
        )
        self.product_request_seeded = request_seeded
        self.product_request_ready = resolved_request_ready

    def _product_request_is_seeded(self) -> bool:
        if (
            not PRODUCT_RELAY_MODE
            or not _injection_allowed()
            or not PRODUCT_SESSION_VALID
            or self.product_parent_shutdown_requested
        ):
            return False
        return self._product_dispatch_state() is not None

    def _product_request_is_ready(self, now: float) -> bool:
        if (
            not self._product_request_is_seeded()
            or self.pending_command is not None
            or self.dispatch_arm is not None
            or (self.attempt is not None and not self.attempt.settled)
            or not self._product_cooldown_ready(now)
        ):
            return False
        state = self._product_dispatch_state()
        if state is None or state.pending_offset_advance is not None:
            return False
        translation = state.counter_translation
        if state.decoder.buffered_bytes or (
            translation is not None
            and (translation.failed or translation.buffered_bytes)
        ):
            return False
        return True

    def _product_dispatch_state(self) -> TrackedFlow | None:
        if not PRODUCT_RELAY_MODE:
            return None
        candidates = [
            state
            for state in self.flows.values()
            if state.flow.live
            and state.unique_account_id is not None
            and state.crossregion_identifier is not None
            and (
                state.last_api_counter is not None
                or (
                    state.counter_translation is not None
                    and not state.counter_translation.failed
                )
            )
            and state.relay_unusable_reason is None
            and not state.flow_recycle_requested
            and (
                state.counter_translation is None
                or not state.counter_translation.failed
            )
        ]
        if not candidates:
            self.armed_flow_id = None
            return None
        # Once a flow carries an offset, keep using that live API client until
        # it closes. This avoids creating independent translated streams merely
        # because another authenticated API socket was observed more recently.
        state = max(
            candidates,
            key=lambda candidate: (
                candidate.counter_translation is not None,
                candidate.last_api_observed_at,
            ),
        )
        self.armed_flow_id = state.flow.id
        return state

    def _check_product_parent_liveness(self) -> bool:
        if not PRODUCT_RELAY_MODE:
            return True
        if self.product_parent_shutdown_requested:
            return False
        if PRODUCT_PARENT_PID is not None and process_is_alive(PRODUCT_PARENT_PID):
            return True
        self.product_parent_shutdown_requested = True
        self._write_product_ready_state(time.monotonic(), request_ready=False)
        try:
            ctx.master.shutdown()
        except Exception as error:
            append_event(
                STATE_DIR,
                "product_parent_shutdown_request_failed",
                errorType=type(error).__name__,
            )
        return False

    def _product_cooldown_ready(self, now: float) -> bool:
        return bool(
            not PRODUCT_RELAY_MODE
            or self.last_dispatch_at is None
            or self._product_cooldown_remaining_seconds(now) <= 0
        )

    def _product_cooldown_remaining_seconds(self, now: float) -> float:
        if not PRODUCT_RELAY_MODE or self.last_dispatch_at is None:
            return 0.0
        return max(
            0.0,
            PRODUCT_DISPATCH_INTERVAL_SECONDS - (now - self.last_dispatch_at),
        )

    def _product_cooldown_remaining_ms(self, now: float) -> int:
        return round(self._product_cooldown_remaining_seconds(now) * 1000)

    @staticmethod
    def _command_wait_seconds() -> float:
        return (
            PRODUCT_COMMAND_WAIT_SECONDS
            if PRODUCT_RELAY_MODE
            else COMMAND_WAIT_SECONDS
        )

    def _pending_deadline_reached(self, now: float) -> bool:
        pending = self.pending_command
        return bool(
            pending is not None
            and now - pending.received_at >= self._command_wait_seconds()
        )

    def _cancel_dispatch_retry(self) -> None:
        handle = self.dispatch_retry_handle
        self.dispatch_retry_handle = None
        if handle is not None:
            handle.cancel()

    def _schedule_dispatch_retry(self, delay_seconds: float) -> None:
        if not PRODUCT_RELAY_MODE or self.pending_command is None:
            return
        existing = self.dispatch_retry_handle
        if existing is not None and not existing.cancelled():
            return
        now = time.monotonic()
        deadline_remaining = (
            self._command_wait_seconds()
            - (now - self.pending_command.received_at)
        )
        delay = min(max(delay_seconds, 0.0), max(deadline_remaining, 0.0))
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self.dispatch_retry_handle = loop.call_later(
            delay,
            self._run_scheduled_dispatch_retry,
        )

    def _run_scheduled_dispatch_retry(self) -> None:
        self.dispatch_retry_handle = None
        try:
            self._retry_pending_dispatch_from_event()
        except Exception as error:
            append_event(
                STATE_DIR,
                "product_dispatch_retry_error",
                errorType=type(error).__name__,
            )

    def _retry_pending_dispatch_from_event(self) -> None:
        if self.pending_command is None:
            return
        self._maybe_start_counter_scope_epoch()
        self._maybe_dispatch()

    def _defer_dispatch_arm(self, state: TrackedFlow, reason: str) -> None:
        arm = self.dispatch_arm
        if arm is None or arm.flow_id != state.flow.id:
            return
        self.dispatch_arm = None
        append_event(
            STATE_DIR,
            "product_dispatch_arm_deferred",
            commandId=arm.command_id,
            flowId=_safe_flow_id(state.flow.id),
            reason=reason,
            seedRetained=state.captured_frame is not None,
        )
        self._write_product_ready_state(time.monotonic())

    def _disarm_flow(self, state: TrackedFlow, reason: str) -> None:
        if state.captured_frame is None:
            return
        state.captured_frame = None
        state.previous_legitimate_token = None
        state.normal_request = None
        state.observed_at = 0.0
        state.observed_wall_at = ""
        was_latest = self.armed_flow_id == state.flow.id
        if was_latest and not PRODUCT_RELAY_MODE:
            self.armed_flow_id = None
            (STATE_DIR / ARMED_FILE).unlink(missing_ok=True)
        elif was_latest:
            self.armed_flow_id = None
        append_event(
            STATE_DIR,
            "satanic_zone_flow_disarmed",
            flowId=_safe_flow_id(state.flow.id),
            reason=reason,
            wasLatestArmedFlow=was_latest,
        )
        if PRODUCT_RELAY_MODE and was_latest and self.pending_command is not None:
            self._reject_pending("request_seed_cleared")
        self._write_product_ready_state(time.monotonic())

    def _observe_server_payload(self, state: TrackedFlow, content: bytes) -> None:
        state.last_server_at = time.monotonic()
        self._write_product_ready_state(state.last_server_at)
        state.recent_server_payload.extend(content)
        if len(state.recent_server_payload) > MAX_RESPONSE_BUFFER:
            del state.recent_server_payload[:-MAX_RESPONSE_BUFFER]
        self._observe_product_zone_response(state, content)
        self._observe_legitimate_response(state, content)

        attempt = self.attempt
        if (
            attempt is None
            or attempt.flow_id != state.flow.id
            or attempt.flow_closed
            or (PRODUCT_RELAY_MODE and attempt.settled)
        ):
            return
        attempt.response_buffer.extend(content)
        if len(attempt.response_buffer) > MAX_RESPONSE_BUFFER:
            del attempt.response_buffer[:-MAX_RESPONSE_BUFFER]
        signals = response_signals(bytes(attempt.response_buffer))
        if not attempt.first_response_seen:
            attempt.first_response_seen = True
            attempt.first_server_payload_wall_at = utc_now()
            append_event(
                STATE_DIR,
                "first_server_payload_after_injection",
                commandId=attempt.command_id,
                flowId=_safe_flow_id(state.flow.id),
                byteLength=len(content),
                sha256=_sha256(content),
                signals=signals,
            )
        observation = sanitized_zone_observation(
            bytes(attempt.response_buffer),
            utc_now(),
        )
        if all(signals.values()) and observation is not None and not attempt.zone_response_seen:
            attempt.zone_response_seen = True
            attempt.zone_response_at = time.monotonic()
            attempt.zone_response_wall_at = str(observation["observedAt"])
            attempt.zone_observation = observation
            self._renew_seed_after_manual_response(state, attempt)
            self._settle_attempt(attempt)
            zone_response_before_native = _zone_response_before_native(attempt)
            classification = _attempt_classification(attempt)
            append_event(
                STATE_DIR,
                "satanic_zone_response_after_injection",
                commandId=attempt.command_id,
                flowId=_safe_flow_id(state.flow.id),
                elapsedMs=round((time.monotonic() - attempt.started_at) * 1000),
                signals=signals,
                zoneResponseBeforeNativeClientPayload=zone_response_before_native,
                classification=classification,
            )
            self._write_attempt_result(
                classification,
                attempt,
                outcomeReason=(
                    "zone_response_before_native_client_payload"
                    if classification == "conclusive_positive"
                    else (
                        "zone_response_after_terminal_inconclusive_outcome"
                        if attempt.terminal_inconclusive
                        else "zone_response_after_native_client_payload"
                    )
                ),
                signals=signals,
            )

    def _observe_product_zone_response(
        self,
        state: TrackedFlow,
        content: bytes,
    ) -> None:
        if not PRODUCT_RELAY_MODE or not PRODUCT_SESSION_VALID:
            return
        state.passive_response_buffer.extend(content)
        if len(state.passive_response_buffer) > MAX_RESPONSE_BUFFER:
            del state.passive_response_buffer[:-MAX_RESPONSE_BUFFER]
        completed_at = utc_now()
        observation = sanitized_zone_observation(
            bytes(state.passive_response_buffer),
            completed_at,
        )
        if observation is None:
            return
        # Reset only after a complete sanitized observation. This permits TCP
        # fragmentation while preventing old JSON from being republished when
        # unrelated server traffic arrives later.
        state.passive_response_buffer.clear()
        atomic_write_json(
            STATE_DIR / PRODUCT_OBSERVATION_FILE,
            {
                "schemaVersion": 1,
                "sessionId": PRODUCT_SESSION_ID,
                "observationId": secrets.token_hex(16),
                "completedAt": completed_at,
                "zoneObservation": observation,
            },
        )

    def _renew_seed_after_manual_response(
        self,
        state: TrackedFlow,
        attempt: InjectionAttempt,
    ) -> None:
        baseline = state.normal_request
        if (
            self.armed_flow_id != state.flow.id
            or state.captured_frame is None
            or baseline is None
            or not baseline.zone_response_seen
            or attempt.zone_response_at is None
        ):
            return
        state.observed_at = attempt.zone_response_at
        state.observed_wall_at = attempt.zone_response_wall_at or utc_now()
        baseline.zone_response_seen_at = attempt.zone_response_at
        append_event(
            STATE_DIR,
            "product_request_seed_renewed",
            commandId=attempt.command_id,
            flowId=_safe_flow_id(state.flow.id),
            seedRetained=True,
        )

    def _observe_legitimate_response(self, state: TrackedFlow, content: bytes) -> None:
        baseline = state.normal_request
        if baseline is None:
            return
        attempt = self.attempt
        if (
            attempt is not None
            and attempt.flow_id == state.flow.id
            and not attempt.flow_closed
            and (not PRODUCT_RELAY_MODE or not attempt.settled)
        ):
            return
        baseline.response_buffer.extend(content)
        if len(baseline.response_buffer) > MAX_RESPONSE_BUFFER:
            del baseline.response_buffer[:-MAX_RESPONSE_BUFFER]
        signals = response_signals(bytes(baseline.response_buffer))
        if not baseline.first_response_seen:
            baseline.first_response_seen = True
            append_event(
                STATE_DIR,
                "first_server_payload_after_legitimate_request",
                requestId=baseline.request_id,
                flowId=_safe_flow_id(state.flow.id),
                elapsedMs=round((time.monotonic() - baseline.started_at) * 1000),
                byteLength=len(content),
                sha256=_sha256(content),
                signals=signals,
            )
        if all(signals.values()) and not baseline.zone_response_seen:
            baseline.zone_response_seen = True
            baseline.zone_response_seen_at = time.monotonic()
            append_event(
                STATE_DIR,
                "satanic_zone_response_after_legitimate_request",
                requestId=baseline.request_id,
                flowId=_safe_flow_id(state.flow.id),
                elapsedMs=round((time.monotonic() - baseline.started_at) * 1000),
                signals=signals,
            )
            self._write_armed_state(state, baseline.zone_response_seen_at)

    def _observe_client_payload_after_injection(self, state: TrackedFlow, content: bytes) -> None:
        attempt = self.attempt
        if (
            attempt is None
            or attempt.flow_closed
            or (PRODUCT_RELAY_MODE and attempt.settled)
        ):
            return
        contaminates_selected_scope = (
            attempt.selected_scope != "flow_local" or attempt.flow_id == state.flow.id
        )
        append_event(
            STATE_DIR,
            "native_client_payload_after_injection",
            commandId=attempt.command_id,
            flowId=_safe_flow_id(state.flow.id),
            remotePort=state.remote_port,
            elapsedMs=round((time.monotonic() - attempt.started_at) * 1000),
            byteLength=len(content),
            sha256=_sha256(content),
            zoneResponseAlreadySeen=attempt.zone_response_seen,
            selectedScope=attempt.selected_scope,
            contaminatesSelectedScope=contaminates_selected_scope,
        )
        if not contaminates_selected_scope:
            if not attempt.other_flow_native_payload_seen:
                attempt.other_flow_native_payload_seen = True
                attempt.first_other_flow_native_payload_wall_at = utc_now()
                self._write_attempt_result(
                    _attempt_classification(attempt),
                    attempt,
                    outcomeReason="other_flow_native_payload_does_not_contaminate_flow_local_scope",
                )
            return
        if attempt.native_client_payload_seen:
            return
        attempt.native_client_payload_seen = True
        attempt.native_client_payload_at = time.monotonic()
        attempt.native_client_payload_wall_at = utc_now()
        attempt.native_client_flow_id = _safe_flow_id(state.flow.id)
        attempt.native_client_remote_port = state.remote_port
        self._write_attempt_result(
            _attempt_classification(attempt),
            attempt,
            outcomeReason=(
                "zone_response_before_native_client_payload"
                if _zone_response_before_native(attempt)
                else "awaiting_zone_response_after_native_client_payload"
            ),
        )

    def _translate_client_content(
        self,
        state: TrackedFlow,
        message: Any,
        content: bytes,
        translation: OutboundApiCounterTranslator,
    ) -> CounterTranslationResult:
        internal_error_type: str | None = None
        try:
            result = translation.feed(content)
        except Exception as error:
            internal_error_type = type(error).__name__
            result = translation.halt("translation_internal_error")
        message.content = result.forwarded_content
        self._record_counter_translation_result(
            state,
            result,
            input_byte_length=len(content),
            internal_error_type=internal_error_type,
        )
        return result

    def _commit_pending_offset_advance(
        self,
        state: TrackedFlow,
        translation: OutboundApiCounterTranslator,
        result: CounterTranslationResult,
    ) -> None:
        pending = state.pending_offset_advance
        if pending is None:
            return
        state.pending_offset_advance = None
        attempt = self.attempt
        if result.failure_reason is not None or translation.failed:
            return
        if attempt is None or attempt.command_id != pending.command_id:
            self._make_flow_unusable(
                state,
                "offset_advance_uncertain_after_dispatch",
            )
            return
        try:
            translation.advance_offset_after_dispatch(
                pending.anchor_client_counter
            )
        except Exception as error:
            translation_result = translation.halt(
                "offset_advance_failed_after_dispatch"
            )
            self._record_counter_translation_result(
                state,
                translation_result,
                input_byte_length=0,
                internal_error_type=type(error).__name__,
            )
            self._make_flow_unusable(
                state,
                "offset_advance_failed_after_dispatch",
            )
            return
        append_event(
            STATE_DIR,
            "counter_offset_advanced_after_dispatch",
            commandId=pending.command_id,
            flowId=_safe_flow_id(state.flow.id),
            modulo256=True,
            currentAnchorTranslatedBeforeAdvance=True,
        )
        self._write_attempt_result(
            _attempt_classification(attempt),
            attempt,
            outcomeReason="counter_offset_advanced_after_dispatch",
        )

    def _record_counter_translation_result(
        self,
        state: TrackedFlow,
        result: CounterTranslationResult,
        *,
        input_byte_length: int,
        internal_error_type: str | None,
    ) -> None:
        translation = state.counter_translation
        attempt = self.attempt
        if translation is None or attempt is None or attempt.flow_id != state.flow.id:
            return

        attempt.translated_native_api_frames = translation.translated_api_frame_count
        attempt.translated_native_generic_frames = (
            translation.translated_generic_frame_count
        )
        attempt.counter_translation_withheld_bytes = translation.withheld_byte_count
        translated_frames = (
            result.translated_api_frames + result.translated_generic_frames
        )
        if translated_frames:
            attempt.counter_translation_applied = True
        if result.failure_new:
            attempt.counter_translation_failed = True
            attempt.counter_translation_failure_reason = result.failure_reason
            attempt.terminal_inconclusive = True
            if PRODUCT_RELAY_MODE:
                self._settle_attempt(attempt)
                state.relay_unusable_reason = result.failure_reason
                state.pending_offset_advance = None
                self._disarm_flow(
                    state,
                    "translation_failed_requires_flow_recycle",
                )
            append_event(
                STATE_DIR,
                "counter_offset_translation_failed_closed",
                commandId=attempt.command_id,
                flowId=_safe_flow_id(state.flow.id),
                reason=result.failure_reason,
                errorType=internal_error_type,
                inputByteLength=input_byte_length,
                forwardedByteLength=len(result.forwarded_content),
                withheldByteLength=result.withheld_byte_length,
                translatedApiFrameCount=translation.translated_api_frame_count,
                translatedGenericFrameCount=(
                    translation.translated_generic_frame_count
                ),
                flowRecycleRequired=PRODUCT_RELAY_MODE,
                automaticFlowRecycleSupported=(
                    AUTOMATIC_FLOW_RECYCLE_SUPPORTED
                ),
            )
            if PRODUCT_RELAY_MODE:
                self._request_flow_recycle(state, result.failure_reason or "unknown")
                append_event(
                    STATE_DIR,
                    "translation_uncertainty_flow_recycle_requested",
                    commandId=attempt.command_id,
                    flowId=_safe_flow_id(state.flow.id),
                    automaticFlowRecycleSupported=(
                        AUTOMATIC_FLOW_RECYCLE_SUPPORTED
                    ),
                    futureClientBytesWithheld=True,
                )
            self._write_attempt_result(
                "inconclusive",
                attempt,
                outcomeReason="counter_offset_translation_failed_closed",
            )
            return

        if translated_frames:
            append_event(
                STATE_DIR,
                "counter_offset_translation_forwarded",
                commandId=attempt.command_id,
                flowId=_safe_flow_id(state.flow.id),
                inputByteLength=input_byte_length,
                forwardedByteLength=len(result.forwarded_content),
                translatedApiFrames=result.translated_api_frames,
                translatedGenericFrames=result.translated_generic_frames,
                bufferedByteLength=result.buffered_byte_length,
                frameByteLengthsAndBodiesPreserved=True,
            )
            self._write_attempt_result(
                _attempt_classification(attempt),
                attempt,
                outcomeReason="native_api_counter_offset_translated",
            )
        elif result.buffered_byte_length:
            append_event(
                STATE_DIR,
                "counter_offset_translation_buffered",
                commandId=attempt.command_id,
                flowId=_safe_flow_id(state.flow.id),
                inputByteLength=input_byte_length,
                bufferedByteLength=result.buffered_byte_length,
            )
            self._write_attempt_result(
                _attempt_classification(attempt),
                attempt,
                outcomeReason="native_frame_buffered_for_offset_translation",
            )

    @staticmethod
    def _settle_attempt(attempt: InjectionAttempt) -> None:
        if attempt.settled:
            return
        attempt.settled = True
        attempt.settled_wall_at = utc_now()

    def _observe_injected_frame_dispatch(self, state: TrackedFlow) -> None:
        """Start the product response clock when mitmproxy processes injection.

        The `inject.tcp` command returns after scheduling a connection task, not
        after that task has processed the frame. The re-entrant TCP callback is
        the first reliable relay-local boundary immediately before SendData.
        """

        attempt = self.attempt
        if (
            not PRODUCT_RELAY_MODE
            or attempt is None
            or attempt.settled
            or attempt.flow_id != state.flow.id
            or attempt.dispatch_observed_at is not None
        ):
            return
        self._anchor_product_response_clock(attempt, "injected_frame")

    def _observe_post_reservation_flow_activity(self, state: TrackedFlow) -> None:
        """Fallback response-clock anchor for mitmproxy injection scheduling.

        In normal operation the injected frame returns through ``tcp_message``
        and is recognized by its exact hash. Some live mitmproxy runs have put
        the frame on the wire without surfacing that exact callback to this
        addon. The first later callback on the same flow proves that the
        connection task has resumed, so it is a conservative fallback boundary
        for starting the backend response window.
        """

        attempt = self.attempt
        if (
            not PRODUCT_RELAY_MODE
            or attempt is None
            or attempt.settled
            or attempt.flow_id != state.flow.id
            or attempt.dispatch_observed_at is not None
            or not attempt.counter_translation_armed
        ):
            return
        self._anchor_product_response_clock(attempt, "same_flow_activity")

    @staticmethod
    def _anchor_product_response_clock(
        attempt: InjectionAttempt,
        source: str,
    ) -> None:
        observed_at = time.monotonic()
        attempt.dispatch_observed_at = observed_at
        attempt.dispatch_observed_wall_at = utc_now()
        attempt.dispatch_observation_source = source
        attempt.response_deadline = observed_at + attempt.response_timeout_seconds

    def _make_flow_unusable(self, state: TrackedFlow, reason: str) -> None:
        if state.relay_unusable_reason is None:
            state.relay_unusable_reason = reason
            append_event(
                STATE_DIR,
                "product_relay_flow_unusable",
                flowId=_safe_flow_id(state.flow.id),
                reason=reason,
                automaticFlowRecycleSupported=AUTOMATIC_FLOW_RECYCLE_SUPPORTED,
                futureClientBytesWithheld=True,
            )
        if PRODUCT_RELAY_MODE:
            self._request_flow_recycle(state, reason)
        state.pending_offset_advance = None
        translation = state.counter_translation
        if translation is not None and not translation.failed:
            result = translation.halt(reason)
            self._record_counter_translation_result(
                state,
                result,
                input_byte_length=0,
                internal_error_type=None,
            )
        self._disarm_flow(state, "product_relay_flow_unusable")
        attempt = self.attempt
        if attempt is not None and attempt.flow_id == state.flow.id:
            attempt.terminal_inconclusive = True
            attempt.counter_translation_failed = True
            attempt.counter_translation_failure_reason = reason
            self._settle_attempt(attempt)
            self._write_attempt_result(
                "inconclusive",
                attempt,
                outcomeReason=reason,
                flowRecycleRequired=True,
                automaticFlowRecycleSupported=AUTOMATIC_FLOW_RECYCLE_SUPPORTED,
            )

    def _request_flow_recycle(self, state: TrackedFlow, reason: str) -> None:
        if state.flow_recycle_requested:
            return
        state.flow_recycle_requested = True
        try:
            # mitmproxy 12 exposes flow.kill as a command accepting a sequence.
            # Its command acknowledgement is not proof that both TCP transports
            # closed, so the state remains fail-closed until tcp_end/tcp_error.
            ctx.master.commands.call("flow.kill", [state.flow])
        except Exception as error:
            append_event(
                STATE_DIR,
                "flow_recycle_command_failed",
                flowId=_safe_flow_id(state.flow.id),
                reason=reason,
                errorType=type(error).__name__,
                transportCloseConfirmed=False,
                failClosedUntilFlowEnd=True,
            )
            return
        append_event(
            STATE_DIR,
            "flow_recycle_command_requested",
            flowId=_safe_flow_id(state.flow.id),
            reason=reason,
            command="flow.kill",
            transportCloseConfirmed=False,
            failClosedUntilFlowEnd=True,
        )

    def _close_flow(self, flow: tcp.TCPFlow, event: str, **extra: object) -> None:
        state = self.flows.get(flow.id)
        if state is None:
            return
        if state.decoder.buffered_bytes:
            self.counter_scope.invalidate(flow.id)
            append_event(
                STATE_DIR,
                "client_outbound_stream_closed_with_partial_frame",
                flowId=_safe_flow_id(flow.id),
                scopeModelTainted=True,
            )
        if state.counter_translation is not None:
            translation = state.counter_translation
            if translation.buffered_bytes and not translation.failed:
                self._record_counter_translation_result(
                    state,
                    translation.halt("flow_closed_with_partial_frame"),
                    input_byte_length=0,
                    internal_error_type=None,
                )
            attempt = self.attempt
            if attempt is not None and attempt.flow_id == flow.id:
                attempt.translated_native_api_frames = (
                    translation.translated_api_frame_count
                )
                attempt.translated_native_generic_frames = (
                    translation.translated_generic_frame_count
                )
                attempt.counter_translation_withheld_bytes = (
                    translation.withheld_byte_count
                )
            append_event(
                STATE_DIR,
                "counter_offset_translation_reset",
                flowId=_safe_flow_id(flow.id),
                resetReason=event,
                bufferedByteLength=translation.buffered_bytes,
                translationFailed=translation.failed,
                translatedApiFrameCount=translation.translated_api_frame_count,
                translatedGenericFrameCount=translation.translated_generic_frame_count,
                withheldByteCount=translation.withheld_byte_count,
            )
        append_event(
            STATE_DIR,
            event,
            flowId=_safe_flow_id(flow.id),
            remoteAddress=state.remote_address,
            remotePort=state.remote_port,
            **extra,
        )
        if self.dispatch_arm is not None and self.dispatch_arm.flow_id == flow.id:
            self._reject_pending("armed_target_flow_closed")
        self._disarm_flow(state, "target_flow_closed")
        if self.attempt is not None and self.attempt.flow_id == flow.id:
            if _attempt_classification(self.attempt) != "conclusive_positive":
                self.attempt.terminal_inconclusive = True
            self.attempt.flow_closed = True
            self.attempt.flow_closed_wall_at = utc_now()
            self._settle_attempt(self.attempt)
            classification = _attempt_classification(self.attempt)
            self._write_attempt_result(
                classification,
                self.attempt,
                outcomeReason=(
                    "zone_response_before_native_client_payload"
                    if classification == "conclusive_positive"
                    else "connection_closed_without_conclusive_response"
                ),
                **extra,
            )
        self.counter_scope.forget_flow(flow.id)
        state.counter_translation = None
        state.pending_offset_advance = None
        self.injected_content_hashes = {
            key for key in self.injected_content_hashes if key[0] != flow.id
        }
        self.flows.pop(flow.id, None)
        self._refresh_latest_armed_state(time.monotonic(), force=True)

    async def _command_loop(self) -> None:
        while True:
            if not self._check_product_parent_liveness():
                return
            try:
                self._maybe_start_counter_scope_epoch()
                self._ingest_command()
                if PRODUCT_RELAY_MODE:
                    self._expire_pending_command()
                else:
                    self._maybe_dispatch()
                self._check_attempt_deadlines()
                self._refresh_armed_status()
            except Exception as error:  # Diagnostics must not kill proxy forwarding.
                append_event(
                    STATE_DIR,
                    "poc_internal_error",
                    errorType=type(error).__name__,
                    message=str(error)[:200],
                )
            await asyncio.sleep(0.1)

    def _expire_pending_command(self) -> None:
        if self._pending_deadline_reached(time.monotonic()):
            self._maybe_dispatch()

    def _maybe_start_counter_scope_epoch(self) -> None:
        if self.counter_scope.epoch_active or self.one_shot_consumed:
            return
        if self.counter_scope.known_counter_flow_count == 0:
            return
        now = time.monotonic()
        tracked_states = list(self.flows.values())
        if not tracked_states or any(
            not state.flow.live for state in tracked_states
        ):
            return
        if any(state.decoder.buffered_bytes for state in tracked_states):
            return
        if any(
            now - state.last_client_at < SCOPE_QUIESCENCE_SECONDS
            for state in tracked_states
        ):
            return
        if not self.counter_scope.start_clean_epoch():
            return
        append_event(
            STATE_DIR,
            "counter_scope_clean_epoch_started",
            trackedFlowCount=len(tracked_states),
            candidateFlowCount=self.counter_scope.known_counter_flow_count,
            allDecoderBuffersEmpty=True,
            allClientStreamsQuiescent=True,
            quiescenceMs=round(SCOPE_QUIESCENCE_SECONDS * 1000),
        )
        self._refresh_latest_armed_state(now, force=True)

    def _refresh_armed_status(self) -> None:
        self._refresh_latest_armed_state(time.monotonic(), force=False)

    def _refresh_latest_armed_state(self, now: float, *, force: bool) -> None:
        if PRODUCT_RELAY_MODE:
            self._write_product_ready_state(now)
            return
        if self.armed_flow_id is None:
            self._write_product_ready_state(now)
            return
        if not force and now - self.last_armed_status_refresh_at < 1.0:
            return
        state = self.flows.get(self.armed_flow_id)
        if state is not None:
            self._write_armed_state(state, now)
        else:
            self._write_product_ready_state(now)

    def _ingest_command(self) -> None:
        command_path = STATE_DIR / COMMAND_FILE
        if not command_path.exists():
            return
        processing_path = STATE_DIR / ".command.processing.json"
        try:
            os.replace(command_path, processing_path)
            command = json.loads(processing_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            append_event(STATE_DIR, "command_rejected", reason="invalid_command_file", message=str(error)[:120])
            return
        finally:
            processing_path.unlink(missing_ok=True)

        if not isinstance(command, dict):
            append_event(STATE_DIR, "command_rejected", reason="invalid_command")
            return
        managed_product_command = bool(
            PRODUCT_RELAY_MODE
            and not isinstance(command.get("schemaVersion"), bool)
            and command.get("schemaVersion") == 1
            and command.get("command") == "refresh_satanic_zone"
        )
        legacy_product_command = bool(
            PRODUCT_RELAY_MODE
            and not isinstance(command.get("schemaVersion"), bool)
            and command.get("schemaVersion") == 2
            and command.get("mode") == "product"
            and command.get("action") == "inject"
        )
        raw_command_id = (
            command.get("commandId")
            if managed_product_command
            else command.get("id")
        )
        command_id = str(raw_command_id or "")[:64]
        if (
            not command_id
            or not _command_id_valid(command_id)
            or (
                PRODUCT_RELAY_MODE
                and not (managed_product_command or legacy_product_command)
            )
            or (
                not PRODUCT_RELAY_MODE
                and command.get("action") != "inject"
            )
        ):
            append_event(
                STATE_DIR,
                "command_rejected",
                commandId=(
                    command_id
                    if _command_id_valid(command_id)
                    else None
                ),
                reason="invalid_command",
            )
            return
        if PRODUCT_RELAY_MODE and (
            command.get("sessionId") != PRODUCT_SESSION_ID
            or not PRODUCT_SESSION_VALID
        ):
            self._reject_command(command_id, "product_session_mismatch")
            return
        if managed_product_command:
            requested_at = command.get("requestedAt")
            raw_spacing_ms = command.get("minimumDispatchSpacingMs")
            if (
                not isinstance(requested_at, str)
                or not requested_at
                or len(requested_at) > 64
                or isinstance(raw_spacing_ms, bool)
                or raw_spacing_ms != 30_000
            ):
                self._reject_command(command_id, "invalid_product_command_contract")
                return
        if self.pending_command is not None or self.dispatch_arm is not None:
            self._reject_command(command_id, "another_command_is_pending")
            return
        if PRODUCT_RELAY_MODE and self.attempt is not None and not self.attempt.settled:
            self._reject_command(command_id, "another_command_is_in_flight")
            return
        if not PRODUCT_RELAY_MODE and (
            self.one_shot_consumed or (STATE_DIR / CONSUMED_FILE).exists()
        ):
            self.one_shot_consumed = True
            self.attempt_count = MAX_INJECTIONS
            self._reject_command(command_id, "one_shot_limit_reached")
            return
        if not _injection_allowed():
            self._reject_command(command_id, "injection_disabled_observe_only")
            return
        strategy = (
            "computed"
            if managed_product_command
            else str(command.get("strategy", "computed"))
        )
        if strategy not in INJECTION_STRATEGIES:
            self._reject_command(command_id, "invalid_injection_strategy", strategy=strategy[:32])
            return
        if not PRODUCT_RELAY_MODE and not WIRE_CONFIRMATION_ENABLED:
            self._reject_command(command_id, "wire_confirmation_required")
            return
        now = time.monotonic()
        self.pending_command = PendingCommand(command_id=command_id, strategy=strategy, received_at=time.monotonic())
        self._write_product_ready_state(now)
        append_event(
            STATE_DIR,
            "injection_command_received",
            commandId=command_id,
            injectionStrategy=strategy,
            mode="product" if PRODUCT_RELAY_MODE else "research_one_shot",
        )
        self._maybe_dispatch()

    def _maybe_dispatch(self) -> None:
        pending = self.pending_command
        if pending is None:
            return
        if PRODUCT_RELAY_MODE:
            self._maybe_dispatch_product(pending)
            return
        now = time.monotonic()
        deadline_reached = self._pending_deadline_reached(now)
        if self.dispatch_arm is not None:
            if deadline_reached:
                self._reject_pending("target_anchor_wait_timeout")
            return
        if pending.strategy != "computed":
            self._reject_pending("invalid_injection_strategy")
            return
        if not PRODUCT_RELAY_MODE and not WIRE_CONFIRMATION_ENABLED:
            self._reject_pending("wire_confirmation_required")
            return
        if not PRODUCT_RELAY_MODE and (
            self.one_shot_consumed
            or self.attempt_count >= MAX_INJECTIONS
            or (STATE_DIR / CONSUMED_FILE).exists()
        ):
            self.one_shot_consumed = True
            self.attempt_count = MAX_INJECTIONS
            self._reject_pending("one_shot_limit_reached")
            return
        if PRODUCT_RELAY_MODE and not self._product_cooldown_ready(now):
            remaining_seconds = self._product_cooldown_remaining_seconds(now)
            remaining_ms = round(remaining_seconds * 1000)
            if deadline_reached:
                self._reject_pending(
                    "product_dispatch_cooldown",
                    retryAfterMs=remaining_ms,
                )
            else:
                self._schedule_dispatch_retry(remaining_seconds)
            return

        candidates = [
            state
            for state in self.flows.values()
            if state.captured_frame is not None
            and state.flow.id == self.armed_flow_id
            and state.flow.live
            and state.relay_unusable_reason is None
            and (
                PRODUCT_RELAY_MODE
                or now - state.observed_at <= FRAME_MAX_AGE_SECONDS
            )
        ]
        if not candidates:
            if deadline_reached:
                self._reject_pending("no_live_armed_flow")
            return
        state = max(candidates, key=lambda candidate: candidate.observed_at)
        tracked_states = list(self.flows.values())
        if any(not candidate.flow.live for candidate in tracked_states):
            if deadline_reached:
                self._reject_pending("tracked_flow_lifecycle_incomplete")
            return
        live_states = tracked_states
        buffered_states = [
            candidate for candidate in live_states if candidate.decoder.buffered_bytes
        ]
        if buffered_states:
            for buffered_state in buffered_states:
                self.counter_scope.invalidate(buffered_state.flow.id)
                if PRODUCT_RELAY_MODE:
                    self._defer_dispatch_arm(
                        buffered_state,
                        "target_stream_partial_at_dispatch",
                    )
                else:
                    self._disarm_flow(
                        buffered_state,
                        "target_stream_partial_at_dispatch",
                    )
            self._refresh_latest_armed_state(now, force=True)
            if not PRODUCT_RELAY_MODE or deadline_reached:
                self._reject_pending("counter_synchronization_incomplete_frame")
            return
        client_idle_wait = max(
            (
                SCOPE_QUIESCENCE_SECONDS - (now - candidate.last_client_at)
                for candidate in live_states
            ),
            default=0.0,
        )
        if client_idle_wait > 0:
            if deadline_reached:
                self._reject_pending("tracked_client_stream_not_idle")
            else:
                self._schedule_dispatch_retry(client_idle_wait)
            return

        assert state.captured_frame is not None
        baseline = state.normal_request
        if baseline is None or not baseline.zone_response_seen:
            if deadline_reached:
                self._reject_pending("legitimate_zone_response_not_observed")
            return
        server_idle_wait = SERVER_IDLE_SECONDS - (now - state.last_server_at)
        if server_idle_wait > 0:
            if deadline_reached:
                self._reject_pending("target_server_stream_not_idle")
            else:
                self._schedule_dispatch_retry(server_idle_wait)
            return
        if (
            not PRODUCT_RELAY_MODE
            and WIRE_CONFIRMATION_ENABLED
            and state.remote_port not in WIRE_CONFIRMATION_PORTS
        ):
            self._reject_pending(
                "armed_target_not_covered_by_wire_confirmation",
                wireConfirmationEnabled=True,
                targetCoveredByWireConfirmation=False,
                remotePort=state.remote_port,
            )
            return
        active_translation = state.counter_translation
        if PRODUCT_RELAY_MODE and active_translation is not None:
            if (
                active_translation.failed
                or state.pending_offset_advance is not None
                or active_translation.buffered_bytes
            ):
                if deadline_reached:
                    self._reject_pending("counter_translation_not_ready")
                return
            selected_scope = "flow_local"
            selected_counter = active_translation.last_client_counter
            scope_evidence = self.counter_scope.evidence(
                state.flow.id,
                now,
                COUNTER_SYNC_MAX_AGE_SECONDS,
            ).persistable()
            scope_evidence["translatorContinuityReady"] = True
            uses_translation_continuity = True
        else:
            scope_selection = self.counter_scope.select(
                state.flow.id,
                now,
                COUNTER_SYNC_MAX_AGE_SECONDS,
            )
            if scope_selection is None:
                scope_evidence = self.counter_scope.evidence(
                    state.flow.id,
                    now,
                    COUNTER_SYNC_MAX_AGE_SECONDS,
                ).persistable()
                self._refresh_latest_armed_state(now, force=True)
                if not PRODUCT_RELAY_MODE or deadline_reached:
                    self._reject_pending(
                        "counter_scope_ambiguous",
                        scopeEvidence=scope_evidence,
                    )
                return
            selected_scope = scope_selection.scope
            selected_counter = scope_selection.current_counter
            scope_evidence = scope_selection.evidence.persistable()
            uses_translation_continuity = False

        if not PRODUCT_RELAY_MODE:
            wire_session_valid, wire_session_evidence = _validate_wire_session(
                state.remote_port
            )
            if not wire_session_valid:
                self._reject_pending(
                    "wire_confirmation_session_invalid",
                    **wire_session_evidence,
                )
                return

        self._cancel_dispatch_retry()
        self.dispatch_arm = DispatchArm(
            command_id=pending.command_id,
            flow_id=state.flow.id,
            armed_at=now,
            armed_wall_at=utc_now(),
            selected_scope=selected_scope,
            current_counter=selected_counter,
            scope_evidence=scope_evidence,
            baseline_request_id=baseline.request_id,
            uses_translation_continuity=uses_translation_continuity,
        )
        self._write_product_ready_state(now)
        append_event(
            STATE_DIR,
            "injection_command_armed_for_next_target_anchor",
            commandId=pending.command_id,
            flowId=_safe_flow_id(state.flow.id),
            selectedScope=selected_scope,
            scopeEvidence=scope_evidence,
            targetAnchorScopePolicy=TARGET_ANCHOR_SCOPE_POLICY,
            targetAnchorScopeRelaxationUsed=False,
            translatorContinuityUsed=uses_translation_continuity,
            targetDecoderEmpty=True,
            allTrackedDecodersEmpty=True,
            oneShotReserved=False,
        )
        if not PRODUCT_RELAY_MODE:
            atomic_write_json(
                STATE_DIR / RESULT_FILE,
                {
                    **_state_protocol_fields(),
                    "status": "awaiting_target_anchor",
                    "commandId": pending.command_id,
                    "injectionStrategy": pending.strategy,
                    "selectedScope": selected_scope,
                    "scopeEvidence": scope_evidence,
                    "targetAnchorScopePolicy": TARGET_ANCHOR_SCOPE_POLICY,
                    "targetAnchorScopeRelaxationUsed": False,
                    "armedAt": self.dispatch_arm.armed_wall_at,
                    "updatedAt": utc_now(),
                    "oneShotReserved": False,
                    "nextTargetApiPacketDuplicateRisk": True,
                },
            )

    def _maybe_dispatch_product(self, pending: PendingCommand) -> None:
        """Dispatch from the smallest verified same-flow API context.

        Product commands do not wait for a prior SZ exchange, a quiet server,
        other flows, or counter-scope qualification. They remain committed until
        this relay has one live authenticated API flow, its exact current API
        counter, and an empty decoder boundary. A bounded pre-dispatch timeout
        prevents a command from firing after the controller has stopped waiting.
        """

        now = time.monotonic()
        if self._pending_deadline_reached(now):
            self._timeout_pending_before_dispatch("api_context_wait_timeout")
            return
        if pending.strategy != "computed":
            self._reject_pending("invalid_injection_strategy")
            return
        if not self._product_cooldown_ready(now):
            self._schedule_dispatch_retry(
                self._product_cooldown_remaining_seconds(now)
            )
            return

        state = self._product_dispatch_state()
        if state is None:
            return
        translation = state.counter_translation
        if (
            state.decoder.buffered_bytes
            or state.pending_offset_advance is not None
            or (
                translation is not None
                and (translation.failed or translation.buffered_bytes)
            )
        ):
            return
        if (
            state.unique_account_id is None
            or state.crossregion_identifier is None
        ):
            return

        client_counter = (
            translation.last_client_counter
            if translation is not None
            else state.last_api_counter
        )
        if client_counter is None:
            return
        try:
            body = _canonical_satanic_zone_body(
                state.unique_account_id,
                state.crossregion_identifier,
            )
            server_counter = (
                client_counter
                + (translation.counter_offset if translation is not None else 0)
                + 1
            ) % 256
            injected_frame = build_frame(
                body,
                computed_request_token(body, server_counter),
            )
        except (FrameError, ValueError):
            # This can only occur if in-memory identity validation and frame
            # construction disagree. Discard the context and wait for a fresh,
            # ordinary authenticated API request rather than sending anything.
            state.unique_account_id = None
            state.crossregion_identifier = None
            state.last_api_counter = None
            state.last_api_observed_at = 0.0
            return

        injected_summary = frame_summary(injected_frame)
        scope_evidence: dict[str, bool | int] = {
            "sameFlowApiContext": True,
            "uniqueApiCounter": True,
            "targetDecoderEmpty": True,
            "translatorContinuity": translation is not None,
        }
        started_wall_at = utc_now()
        attempt = InjectionAttempt(
            command_id=pending.command_id,
            strategy=pending.strategy,
            flow_id=state.flow.id,
            started_at=now,
            started_wall_at=started_wall_at,
            response_deadline=(
                now + PRODUCT_UNOBSERVED_RESPONSE_TIMEOUT_SECONDS
            ),
            stable_deadline=now + STABLE_SECONDS,
            response_timeout_seconds=PRODUCT_RESPONSE_TIMEOUT_SECONDS,
            selected_scope="flow_local",
            scope_evidence=scope_evidence,
            target_anchor_scope_policy="same_flow_api_context",
        )
        self._cancel_dispatch_retry()
        self.attempt_count += 1
        self.attempt = attempt
        self.pending_command = None
        self.dispatch_arm = None

        if translation is None:
            translation = OutboundApiCounterTranslator(
                client_counter,
                counter_offset=1,
            )
            # Install before calling inject.tcp so any re-entrant native callback
            # cannot escape with the pre-injection API counter.
            state.counter_translation = translation
        else:
            try:
                translation.advance_offset_after_dispatch(client_counter)
            except Exception as error:
                result = translation.halt("offset_advance_failed_before_dispatch")
                self._record_counter_translation_result(
                    state,
                    result,
                    input_byte_length=0,
                    internal_error_type=type(error).__name__,
                )
                attempt.terminal_inconclusive = True
                self._settle_attempt(attempt)
                self._make_flow_unusable(
                    state,
                    "offset_advance_failed_before_dispatch",
                )
                return
            append_event(
                STATE_DIR,
                "counter_offset_advanced_for_dispatch",
                commandId=attempt.command_id,
                flowId=_safe_flow_id(state.flow.id),
                modulo256=True,
            )

        attempt.counter_translation_armed = True
        self.last_dispatch_at = now
        self.last_dispatch_wall_at = started_wall_at
        self.next_dispatch_wall_at = _utc_after_seconds(
            PRODUCT_DISPATCH_INTERVAL_SECONDS
        )
        content_hash = str(injected_summary["sha256"])
        self.injected_content_hashes.add((state.flow.id, content_hash))
        append_event(
            STATE_DIR,
            "injection_reserved",
            commandId=attempt.command_id,
            injectionStrategy=attempt.strategy,
            flowId=_safe_flow_id(state.flow.id),
            selectedScope=attempt.selected_scope,
            scopeEvidence=attempt.scope_evidence,
            targetAnchorScopePolicy=attempt.target_anchor_scope_policy,
            translatorContinuityUsed=translation.counter_offset > 1,
            reusableSession=True,
            nextTargetApiPacketDuplicateRisk=False,
        )

        try:
            ctx.master.commands.call(
                "inject.tcp",
                state.flow,
                False,
                injected_frame,
            )
        except Exception as error:
            self.injected_content_hashes.discard((state.flow.id, content_hash))
            attempt.dispatch_outcome_uncertain = True
            attempt.terminal_inconclusive = True
            self._settle_attempt(attempt)
            self._make_flow_unusable(
                state,
                "dispatch_outcome_uncertain_requires_flow_recycle",
            )
            append_event(
                STATE_DIR,
                "injection_dispatch_outcome_uncertain",
                commandId=attempt.command_id,
                flowId=_safe_flow_id(state.flow.id),
                errorType=type(error).__name__,
                nextTargetApiPacketDuplicateRisk=True,
                flowRecycleRequired=True,
                automaticFlowRecycleSupported=AUTOMATIC_FLOW_RECYCLE_SUPPORTED,
            )
            self._write_attempt_result(
                "inconclusive",
                attempt,
                outcomeReason="dispatch_outcome_uncertain",
                errorType=type(error).__name__,
            )
            return

        append_event(
            STATE_DIR,
            "counter_offset_translation_armed",
            commandId=attempt.command_id,
            flowId=_safe_flow_id(state.flow.id),
            fixedModulo256Offset=True,
            cumulativeOffset=True,
            failClosed=True,
            apiFramesResigned=True,
            genericFramesForwardedUnchanged=True,
            frameByteLengthsAndBodiesPreserved=True,
        )
        append_event(
            STATE_DIR,
            "injection_dispatched",
            commandId=attempt.command_id,
            injectionStrategy=attempt.strategy,
            flowId=_safe_flow_id(state.flow.id),
            remoteAddress=state.remote_address,
            remotePort=state.remote_port,
            selectedScope=attempt.selected_scope,
            scopeEvidence=attempt.scope_evidence,
            targetAnchorScopePolicy=attempt.target_anchor_scope_policy,
            byteLength=injected_summary["byteLength"],
            bodyLength=injected_summary["bodyLength"],
            sha256=injected_summary["sha256"],
            offsetTranslationArmed=True,
            nextTargetApiPacketDuplicateRisk=False,
        )
        self._refresh_latest_armed_state(now, force=True)

    def _timeout_pending_before_dispatch(self, reason: str) -> None:
        self._cancel_dispatch_retry()
        pending = self.pending_command
        self.pending_command = None
        self.dispatch_arm = None
        if pending is None:
            return
        append_event(
            STATE_DIR,
            "product_command_timed_out_before_dispatch",
            commandId=pending.command_id,
            reason=reason,
            injectionCallMade=False,
        )
        self._write_product_command_result(
            pending.command_id,
            status="timeout",
            request_accepted=True,
            counter_translation_active=False,
            dispatch_observation="none",
            first_server_payload_seen=False,
            failure_stage="before_dispatch",
        )
        self._write_product_ready_state(time.monotonic())

    def _maybe_dispatch_after_target_callback(
        self,
        state: TrackedFlow,
        *,
        verified_target_api_seen: bool,
        relaxed_anchor_frames_continuous: bool,
        decoded_frame_count: int,
        anchor_counter: int | None,
        verified_frame_counters: tuple[int, ...],
    ) -> None:
        arm = self.dispatch_arm
        pending = self.pending_command
        if arm is None or pending is None:
            return
        if arm.command_id != pending.command_id or arm.flow_id != state.flow.id:
            self._reject_pending("dispatch_anchor_state_mismatch")
            return
        if state.decoder.buffered_bytes:
            # A fragmented target frame is not a complete callback anchor. The
            # continuation may complete it in a later callback.
            return
        if not verified_target_api_seen:
            if PRODUCT_RELAY_MODE:
                if not arm.uses_translation_continuity:
                    self._defer_dispatch_arm(
                        state,
                        "target_anchor_not_verified_api",
                    )
                return
            self._reject_pending("target_anchor_not_verified_api")
            return

        now = time.monotonic()
        if self._pending_deadline_reached(now):
            self._reject_pending("target_anchor_wait_timeout")
            return
        if (
            self.armed_flow_id != state.flow.id
            or state.captured_frame is None
            or not state.flow.live
            or (
                not PRODUCT_RELAY_MODE
                and now - state.observed_at > FRAME_MAX_AGE_SECONDS
            )
        ):
            self._reject_pending("armed_target_changed_before_anchor")
            return

        tracked_states = list(self.flows.values())
        if any(not candidate.flow.live for candidate in tracked_states):
            self._reject_pending("tracked_flow_lifecycle_incomplete")
            return
        buffered_states = [
            candidate
            for candidate in tracked_states
            if candidate.decoder.buffered_bytes
        ]
        if buffered_states:
            for buffered_state in buffered_states:
                self.counter_scope.invalidate(buffered_state.flow.id)
                if not PRODUCT_RELAY_MODE:
                    self._disarm_flow(
                        buffered_state,
                        "target_stream_partial_at_anchor_dispatch",
                    )
            if PRODUCT_RELAY_MODE:
                self._defer_dispatch_arm(
                    state,
                    "target_stream_partial_at_anchor_dispatch",
                )
            self._refresh_latest_armed_state(now, force=True)
            if not PRODUCT_RELAY_MODE:
                self._reject_pending("counter_synchronization_incomplete_frame")
            return

        baseline = state.normal_request
        if baseline is None or not baseline.zone_response_seen:
            baseline_request_id = baseline.request_id if baseline is not None else None
            if arm.waiting_for_baseline_request_id != baseline_request_id:
                arm.waiting_for_baseline_request_id = baseline_request_id
                append_event(
                    STATE_DIR,
                    "target_anchor_deferred_for_legitimate_zone_response",
                    commandId=pending.command_id,
                    flowId=_safe_flow_id(state.flow.id),
                    baselinePresent=baseline is not None,
                    legitimateZoneResponseObserved=False,
                    oneShotReserved=False,
                )
            if not PRODUCT_RELAY_MODE:
                atomic_write_json(
                    STATE_DIR / RESULT_FILE,
                    {
                        **_state_protocol_fields(),
                        "status": "awaiting_post_baseline_target_anchor",
                        "commandId": pending.command_id,
                        "injectionStrategy": pending.strategy,
                        "updatedAt": utc_now(),
                        "legitimateZoneResponseObserved": False,
                        "oneShotReserved": False,
                    },
                )
            return

        if not PRODUCT_RELAY_MODE and (
            self.one_shot_consumed
            or self.attempt_count >= MAX_INJECTIONS
            or (STATE_DIR / CONSUMED_FILE).exists()
        ):
            self.one_shot_consumed = True
            self.attempt_count = MAX_INJECTIONS
            self._reject_pending("one_shot_limit_reached")
            return
        if not PRODUCT_RELAY_MODE and not WIRE_CONFIRMATION_ENABLED:
            self._reject_pending("wire_confirmation_required")
            return
        if not PRODUCT_RELAY_MODE and state.remote_port not in WIRE_CONFIRMATION_PORTS:
            self._reject_pending(
                "armed_target_not_covered_by_wire_confirmation",
                wireConfirmationEnabled=True,
                targetCoveredByWireConfirmation=False,
                remotePort=state.remote_port,
            )
            return
        if PRODUCT_RELAY_MODE and not self._product_cooldown_ready(now):
            self._reject_pending(
                "product_dispatch_cooldown",
                retryAfterMs=self._product_cooldown_remaining_ms(now),
            )
            return
        if state.relay_unusable_reason is not None:
            self._reject_pending(
                "product_flow_recycle_required",
                automaticFlowRecycleSupported=AUTOMATIC_FLOW_RECYCLE_SUPPORTED,
            )
            return
        active_translation = state.counter_translation
        if active_translation is not None and active_translation.failed:
            self._reject_pending(
                "product_flow_recycle_required",
                automaticFlowRecycleSupported=AUTOMATIC_FLOW_RECYCLE_SUPPORTED,
            )
            return
        target_anchor_scope_relaxation_used = False
        translator_continuity_used = False
        if arm.uses_translation_continuity:
            if (
                active_translation is None
                or active_translation.failed
                or active_translation.buffered_bytes
                or state.pending_offset_advance is not None
            ):
                self._defer_dispatch_arm(
                    state,
                    "translator_continuity_not_ready_at_target_anchor",
                )
                return
            expected_counters = tuple(
                (
                    active_translation.last_client_counter + step
                )
                % 256
                for step in range(1, decoded_frame_count + 1)
            )
            if (
                not verified_frame_counters
                or len(verified_frame_counters) != decoded_frame_count
                or verified_frame_counters != expected_counters
                or anchor_counter != verified_frame_counters[-1]
            ):
                self._defer_dispatch_arm(
                    state,
                    "translator_continuity_not_verified_at_target_anchor",
                )
                return
            selected_scope = arm.selected_scope
            selected_counter = verified_frame_counters[-1]
            selected_scope_evidence = arm.scope_evidence
            translator_continuity_used = True
        else:
            scope_selection = self.counter_scope.select(
                state.flow.id,
                now,
                COUNTER_SYNC_MAX_AGE_SECONDS,
            )
            if scope_selection is None:
                scope_evidence = self.counter_scope.evidence(
                    state.flow.id,
                    now,
                    COUNTER_SYNC_MAX_AGE_SECONDS,
                ).persistable()
                continuity_counter = self._continuity_target_anchor_counter(
                    arm,
                    now=now,
                    relaxed_anchor_frames_continuous=(
                        relaxed_anchor_frames_continuous
                    ),
                    decoded_frame_count=decoded_frame_count,
                    anchor_counter=anchor_counter,
                    baseline_request_id=baseline.request_id,
                )
                if continuity_counter is None:
                    self._refresh_latest_armed_state(now, force=True)
                    if PRODUCT_RELAY_MODE:
                        self._defer_dispatch_arm(
                            state,
                            "counter_scope_ambiguous_at_target_anchor",
                        )
                    else:
                        self._reject_pending(
                            "counter_scope_ambiguous_at_target_anchor",
                            scopeEvidence=scope_evidence,
                            targetAnchorScopeRelaxationUsed=False,
                        )
                    return
                selected_scope = arm.selected_scope
                selected_counter = continuity_counter
                selected_scope_evidence = arm.scope_evidence
                target_anchor_scope_relaxation_used = True
                append_event(
                    STATE_DIR,
                    (
                        "product_target_anchor_continuity_used"
                        if PRODUCT_RELAY_MODE
                        else "uat_relaxed_target_anchor_scope_recheck_used"
                    ),
                    commandId=pending.command_id,
                    flowId=_safe_flow_id(state.flow.id),
                    targetAnchorScopePolicy=TARGET_ANCHOR_SCOPE_POLICY,
                    targetAnchorScopeRelaxationUsed=True,
                    strictScopeReadyAtTargetAnchor=False,
                    sameFlow=True,
                    allAnchorFramesVerifiedContinuous=True,
                    decodedFrameCount=decoded_frame_count,
                    leaseAgeMs=round((now - arm.armed_at) * 1000),
                )
            else:
                selected_scope = scope_selection.scope
                selected_counter = scope_selection.current_counter
                selected_scope_evidence = scope_selection.evidence.persistable()

        translation_offset = (
            active_translation.counter_offset
            if PRODUCT_RELAY_MODE and active_translation is not None
            else 0
        )
        try:
            injected_frame = build_computed_satanic_zone_request(
                state.captured_frame,
                (selected_counter + translation_offset + 1) % 256,
            )
        except FrameError as error:
            self._reject_pending("captured_frame_failed_validation", message=str(error))
            return

        captured_summary = frame_summary(state.captured_frame)
        injected_summary = frame_summary(injected_frame)
        if injected_frame[12:] != state.captured_frame[12:]:
            self._reject_pending("computed_frame_changed_more_than_token")
            return

        if not PRODUCT_RELAY_MODE:
            wire_session_valid, wire_session_evidence = _validate_wire_session(
                state.remote_port
            )
            if not wire_session_valid:
                self._reject_pending(
                    "wire_confirmation_session_invalid_at_target_anchor",
                    **wire_session_evidence,
                )
                return

        started_wall_at = utc_now()
        if not PRODUCT_RELAY_MODE:
            marker_path = STATE_DIR / CONSUMED_FILE
            try:
                reserved = reserve_json_marker(
                    marker_path,
                    {
                        "status": "consumed",
                        "commandId": pending.command_id,
                        "reservedAt": started_wall_at,
                        "injectionStrategy": "computed",
                        "selectedScope": selected_scope,
                        "scopeEvidence": selected_scope_evidence,
                        "targetAnchorScopePolicy": TARGET_ANCHOR_SCOPE_POLICY,
                        "targetAnchorScopeRelaxationUsed": (
                            target_anchor_scope_relaxation_used
                        ),
                        "nextTargetApiPacketDuplicateRisk": True,
                    },
                )
            except OSError as error:
                self.one_shot_consumed = marker_path.exists()
                if self.one_shot_consumed:
                    self.attempt_count = MAX_INJECTIONS
                self._reject_pending(
                    "one_shot_reservation_failed",
                    errorType=type(error).__name__,
                    markerPresent=self.one_shot_consumed,
                )
                return
            if not reserved:
                self.one_shot_consumed = True
                self.attempt_count = MAX_INJECTIONS
                self._reject_pending("one_shot_limit_reached")
                return
            self.one_shot_consumed = True
            self.attempt_count = MAX_INJECTIONS
        else:
            self.attempt_count += 1
        self.attempt = InjectionAttempt(
            command_id=pending.command_id,
            strategy=pending.strategy,
            flow_id=state.flow.id,
            started_at=now,
            started_wall_at=started_wall_at,
            response_deadline=now + RESPONSE_TIMEOUT_SECONDS,
            stable_deadline=now + STABLE_SECONDS,
            selected_scope=selected_scope,
            scope_evidence=selected_scope_evidence,
            target_anchor_scope_policy=TARGET_ANCHOR_SCOPE_POLICY,
            target_anchor_scope_relaxation_used=(
                target_anchor_scope_relaxation_used
            ),
        )
        self.pending_command = None
        self.dispatch_arm = None
        append_event(
            STATE_DIR,
            "injection_reserved",
            commandId=self.attempt.command_id,
            injectionStrategy=self.attempt.strategy,
            flowId=_safe_flow_id(state.flow.id),
            selectedScope=self.attempt.selected_scope,
            scopeEvidence=self.attempt.scope_evidence,
            targetAnchorScopePolicy=self.attempt.target_anchor_scope_policy,
            targetAnchorScopeRelaxationUsed=(
                self.attempt.target_anchor_scope_relaxation_used
            ),
            translatorContinuityUsed=translator_continuity_used,
            reusableSession=PRODUCT_RELAY_MODE,
            nextTargetApiPacketDuplicateRisk=True,
        )
        self._write_attempt_result("dispatch_reserved", self.attempt)

        if not PRODUCT_RELAY_MODE:
            wire_session_still_valid, final_wire_session_evidence = (
                _validate_wire_session(state.remote_port)
            )
            if not wire_session_still_valid:
                self.attempt.terminal_inconclusive = True
                append_event(
                    STATE_DIR,
                    "wire_confirmation_lost_after_reservation",
                    commandId=self.attempt.command_id,
                    flowId=_safe_flow_id(state.flow.id),
                    injectionCallMade=False,
                    nextTargetApiPacketDuplicateRisk=False,
                    **final_wire_session_evidence,
                )
                self._write_attempt_result(
                    "inconclusive",
                    self.attempt,
                    outcomeReason="wire_confirmation_lost_after_reservation",
                    injectionCallMade=False,
                    nextTargetApiPacketDuplicateRisk=False,
                    **final_wire_session_evidence,
                )
                return

        content_hash = str(injected_summary["sha256"])
        self.injected_content_hashes.add((state.flow.id, content_hash))
        translation = active_translation or OutboundApiCounterTranslator(
            selected_counter,
            counter_offset=1,
        )
        if PRODUCT_RELAY_MODE:
            self.last_dispatch_at = now
            self.last_dispatch_wall_at = started_wall_at
            self.next_dispatch_wall_at = _utc_after_seconds(
                PRODUCT_DISPATCH_INTERVAL_SECONDS
            )
        try:
            ctx.master.commands.call("inject.tcp", state.flow, False, injected_frame)
        except Exception as error:
            self.injected_content_hashes.discard((state.flow.id, content_hash))
            self.attempt.dispatch_outcome_uncertain = True
            self.attempt.terminal_inconclusive = True
            self._settle_attempt(self.attempt)
            if PRODUCT_RELAY_MODE:
                state.counter_translation = translation
                self._make_flow_unusable(
                    state,
                    "dispatch_outcome_uncertain_requires_flow_recycle",
                )
            append_event(
                STATE_DIR,
                "injection_dispatch_outcome_uncertain",
                commandId=self.attempt.command_id,
                flowId=_safe_flow_id(state.flow.id),
                errorType=type(error).__name__,
                nextTargetApiPacketDuplicateRisk=True,
                flowRecycleRequired=PRODUCT_RELAY_MODE,
                automaticFlowRecycleSupported=(
                    AUTOMATIC_FLOW_RECYCLE_SUPPORTED
                ),
            )
            self._write_attempt_result(
                "inconclusive",
                self.attempt,
                outcomeReason="dispatch_outcome_uncertain",
                errorType=type(error).__name__,
            )
            return

        if active_translation is None:
            state.counter_translation = translation
        else:
            state.pending_offset_advance = PendingOffsetAdvance(
                command_id=self.attempt.command_id,
                anchor_client_counter=selected_counter,
            )
        self.attempt.counter_translation_armed = True
        append_event(
            STATE_DIR,
            "counter_offset_translation_armed",
            commandId=self.attempt.command_id,
            flowId=_safe_flow_id(state.flow.id),
            fixedModulo256Offset=True,
            cumulativeOffset=PRODUCT_RELAY_MODE,
            existingTranslationContinued=active_translation is not None,
            failClosed=True,
            frameByteLengthsAndBodiesPreserved=True,
        )
        append_event(
            STATE_DIR,
            "injection_dispatched",
            commandId=self.attempt.command_id,
            injectionStrategy=self.attempt.strategy,
            flowId=_safe_flow_id(state.flow.id),
            remoteAddress=state.remote_address,
            remotePort=state.remote_port,
            selectedScope=self.attempt.selected_scope,
            scopeEvidence=self.attempt.scope_evidence,
            targetAnchorScopePolicy=self.attempt.target_anchor_scope_policy,
            targetAnchorScopeRelaxationUsed=(
                self.attempt.target_anchor_scope_relaxation_used
            ),
            capturedTokenHash=captured_summary["tokenHash"],
            injectedTokenHash=injected_summary["tokenHash"],
            byteLength=injected_summary["byteLength"],
            bodyLength=injected_summary["bodyLength"],
            sha256=injected_summary["sha256"],
            offsetTranslationArmed=True,
            nextTargetApiPacketDuplicateRisk=False,
        )
        self._write_attempt_result("pending", self.attempt)
        self._refresh_latest_armed_state(now, force=True)

    @staticmethod
    def _continuity_target_anchor_counter(
        arm: DispatchArm,
        *,
        now: float,
        relaxed_anchor_frames_continuous: bool,
        decoded_frame_count: int,
        anchor_counter: int | None,
        baseline_request_id: str,
    ) -> int | None:
        if not PRODUCT_RELAY_MODE and not UAT_RELAX_TARGET_ANCHOR_SCOPE_RECHECK:
            return None
        if arm.selected_scope != "flow_local":
            return None
        if arm.scope_evidence.get("targetFlowLocalEvidenceReady") is not True:
            return None
        if baseline_request_id != arm.baseline_request_id:
            return None
        lease_age = now - arm.armed_at
        if not 0.0 <= lease_age <= UAT_RELAXED_TARGET_ANCHOR_MAX_AGE_SECONDS:
            return None
        if (
            not relaxed_anchor_frames_continuous
            or decoded_frame_count <= 0
            or anchor_counter is None
        ):
            return None
        expected_counter = (arm.current_counter + decoded_frame_count) % 256
        return anchor_counter if anchor_counter == expected_counter else None

    def _check_attempt_deadlines(self) -> None:
        attempt = self.attempt
        if (
            attempt is None
            or attempt.flow_closed
            or attempt.dispatch_outcome_uncertain
            or (PRODUCT_RELAY_MODE and attempt.settled)
        ):
            return
        now = time.monotonic()
        if now >= attempt.response_deadline and not attempt.zone_response_seen and not attempt.timed_out:
            attempt.timed_out = True
            attempt.terminal_inconclusive = True
            attempt.response_timeout_wall_at = utc_now()
            self._settle_attempt(attempt)
            append_event(
                STATE_DIR,
                "injection_response_timeout",
                commandId=attempt.command_id,
                flowId=_safe_flow_id(attempt.flow_id),
                timeoutMs=round(attempt.response_timeout_seconds * 1000),
                dispatchObserved=attempt.dispatch_observed_at is not None,
                firstServerPayloadSeen=attempt.first_response_seen,
            )
            self._write_attempt_result(
                "inconclusive",
                attempt,
                outcomeReason="response_timeout",
                firstServerPayloadSeen=attempt.first_response_seen,
            )
        if now >= attempt.stable_deadline and not attempt.stable_logged:
            state = self.flows.get(attempt.flow_id)
            if state is not None and state.flow.live:
                if _attempt_classification(attempt) != "conclusive_positive":
                    attempt.terminal_inconclusive = True
                attempt.stable_logged = True
                append_event(
                    STATE_DIR,
                    "connection_stable_after_injection",
                    commandId=attempt.command_id,
                    flowId=_safe_flow_id(attempt.flow_id),
                    stableMs=round(STABLE_SECONDS * 1000),
                    zoneResponseSeen=attempt.zone_response_seen,
                )
                classification = _attempt_classification(attempt)
                self._write_attempt_result(
                    classification,
                    attempt,
                    outcomeReason=(
                        "zone_response_before_native_client_payload"
                        if classification == "conclusive_positive"
                        else "stable_connection_without_conclusive_response"
                    ),
                )

    def _reject_pending(self, reason: str, **extra: object) -> None:
        self._cancel_dispatch_retry()
        if self.pending_command is None:
            self.dispatch_arm = None
            self._write_product_ready_state(time.monotonic())
            return
        command_id = self.pending_command.command_id
        self.pending_command = None
        self.dispatch_arm = None
        self._reject_command(command_id, reason, **extra)

    def _reject_command(self, command_id: str, reason: str, **extra: object) -> None:
        details = {
            "targetAnchorScopePolicy": TARGET_ANCHOR_SCOPE_POLICY,
            "targetAnchorScopeRelaxationUsed": False,
            **extra,
        }
        append_event(
            STATE_DIR,
            "command_rejected",
            commandId=command_id,
            reason=reason,
            **details,
        )
        if PRODUCT_RELAY_MODE:
            self._write_product_command_result(
                command_id,
                status="rejected",
                request_accepted=False,
                counter_translation_active=False,
            )
            self._write_product_ready_state(time.monotonic())
            return
        atomic_write_json(
            STATE_DIR / RESULT_FILE,
            {
                **_state_protocol_fields(),
                "status": "command_rejected",
                "commandId": command_id,
                "reason": reason,
                "at": utc_now(),
                **details,
            },
        )

    def _write_attempt_result(self, status: str, attempt: InjectionAttempt, **extra: object) -> None:
        if PRODUCT_RELAY_MODE:
            if not attempt.settled:
                return
            state = self.flows.get(attempt.flow_id)
            translation_active = bool(
                state is not None
                and state.counter_translation is not None
                and not state.counter_translation.failed
                and state.relay_unusable_reason is None
                and attempt.counter_translation_armed
                and not attempt.counter_translation_failed
            )
            classification = _attempt_classification(attempt)
            if (
                classification == "conclusive_positive"
                and attempt.zone_observation is not None
                and translation_active
            ):
                product_status = "success"
            elif attempt.timed_out:
                product_status = "timeout"
            else:
                product_status = "failed"
            self._write_product_command_result(
                attempt.command_id,
                status=product_status,
                request_accepted=True,
                counter_translation_active=translation_active,
                zone_observation=(
                    attempt.zone_observation
                    if product_status == "success"
                    else None
                ),
                completed_at=attempt.settled_wall_at,
                dispatch_observation=(
                    attempt.dispatch_observation_source or "none"
                ),
                first_server_payload_seen=attempt.first_response_seen,
                failure_stage=(
                    "awaiting_response"
                    if attempt.timed_out
                    else (
                        "counter_translation"
                        if attempt.counter_translation_failed
                        else "relay_integrity"
                    )
                    if product_status == "failed"
                    else None
                ),
                response_timeout_ms=round(
                    (
                        attempt.response_timeout_seconds
                        if attempt.dispatch_observation_source is not None
                        else PRODUCT_UNOBSERVED_RESPONSE_TIMEOUT_SECONDS
                    )
                    * 1000
                ),
            )
            self._write_product_ready_state(time.monotonic())
            return
        atomic_write_json(
            STATE_DIR / RESULT_FILE,
            {
                **_state_protocol_fields(),
                "status": status,
                "commandId": attempt.command_id,
                "injectionStrategy": attempt.strategy,
                "selectedScope": attempt.selected_scope,
                "scopeEvidence": attempt.scope_evidence,
                "targetAnchorScopePolicy": attempt.target_anchor_scope_policy,
                "targetAnchorScopeRelaxationUsed": (
                    attempt.target_anchor_scope_relaxation_used
                ),
                "startedAt": attempt.started_wall_at,
                "updatedAt": utc_now(),
                "classification": _attempt_classification(attempt),
                "zoneResponseSeen": attempt.zone_response_seen,
                "zoneResponseAt": attempt.zone_response_wall_at,
                "zoneObservation": attempt.zone_observation,
                "zoneResponseBeforeNativeClientPayload": _zone_response_before_native(attempt),
                "nativeClientPayloadBeforeZoneResponse": _native_before_zone_response(attempt),
                "firstServerPayloadSeen": attempt.first_response_seen,
                "firstServerPayloadAt": attempt.first_server_payload_wall_at,
                "nativeClientPayloadSeen": attempt.native_client_payload_seen,
                "firstNativeClientPayloadAt": attempt.native_client_payload_wall_at,
                "firstNativeClientFlowId": attempt.native_client_flow_id,
                "firstNativeClientRemotePort": attempt.native_client_remote_port,
                "otherFlowNativePayloadSeen": attempt.other_flow_native_payload_seen,
                "firstOtherFlowNativePayloadAt": (
                    attempt.first_other_flow_native_payload_wall_at
                ),
                "flowClosed": attempt.flow_closed,
                "flowClosedAt": attempt.flow_closed_wall_at,
                "responseTimedOut": attempt.timed_out,
                "responseTimeoutAt": attempt.response_timeout_wall_at,
                "dispatchOutcomeUncertain": attempt.dispatch_outcome_uncertain,
                "terminalInconclusive": attempt.terminal_inconclusive,
                "settled": attempt.settled,
                "settledAt": attempt.settled_wall_at,
                "availabilityConsumed": not PRODUCT_RELAY_MODE,
                "minimumDispatchIntervalMs": (
                    round(PRODUCT_DISPATCH_INTERVAL_SECONDS * 1000)
                    if PRODUCT_RELAY_MODE
                    else None
                ),
                "lastDispatchAt": self.last_dispatch_wall_at,
                "nextDispatchAt": self.next_dispatch_wall_at,
                "offsetTranslationArmed": attempt.counter_translation_armed,
                "offsetTranslationApplied": attempt.counter_translation_applied,
                "offsetTranslationFailed": attempt.counter_translation_failed,
                "offsetTranslationFailureReason": (
                    attempt.counter_translation_failure_reason
                ),
                "translatedNativeApiFrames": attempt.translated_native_api_frames,
                "translatedNativeGenericFrames": (
                    attempt.translated_native_generic_frames
                ),
                "translationWithheldBytes": (
                    attempt.counter_translation_withheld_bytes
                ),
                "nextTargetApiPacketDuplicateRisk": (
                    not attempt.counter_translation_armed
                ),
                **extra,
            },
        )

    def _write_product_command_result(
        self,
        command_id: str,
        *,
        status: str,
        request_accepted: bool,
        counter_translation_active: bool,
        zone_observation: dict[str, object] | None = None,
        completed_at: str | None = None,
        dispatch_observation: str | None = None,
        first_server_payload_seen: bool | None = None,
        failure_stage: str | None = None,
        response_timeout_ms: int | None = None,
    ) -> None:
        if (
            not PRODUCT_RELAY_MODE
            or status not in {"success", "rejected", "timeout", "failed"}
            or not PRODUCT_COMMAND_ID_PATTERN.fullmatch(command_id)
            or command_id in self.product_terminal_results_written
        ):
            return
        result_path = STATE_DIR / result_file_for_command(command_id)
        if result_path.exists():
            self.product_terminal_results_written.add(command_id)
            append_event(
                STATE_DIR,
                "product_command_result_preserved",
                commandId=command_id,
                reason="terminal_result_already_exists",
            )
            return
        result: dict[str, object] = {
            "schemaVersion": 1,
            "sessionId": PRODUCT_SESSION_ID,
            "commandId": command_id,
            "completedAt": completed_at or utc_now(),
            "status": status,
        }
        if status == "success" and zone_observation is not None:
            result["requestAccepted"] = request_accepted
            result["counterTranslationActive"] = counter_translation_active
            result["zoneObservation"] = zone_observation
        if dispatch_observation in {
            "injected_frame",
            "same_flow_activity",
            "none",
        }:
            result["dispatchObservation"] = dispatch_observation
        if isinstance(first_server_payload_seen, bool):
            result["firstServerPayloadSeen"] = first_server_payload_seen
        if failure_stage in {
            "before_dispatch",
            "awaiting_response",
            "counter_translation",
            "relay_integrity",
        }:
            result["failureStage"] = failure_stage
        if (
            isinstance(response_timeout_ms, int)
            and not isinstance(response_timeout_ms, bool)
            and 1000 <= response_timeout_ms <= 30_000
        ):
            result["responseTimeoutMs"] = response_timeout_ms
        atomic_write_json(result_path, result)
        self.product_terminal_results_written.add(command_id)


def _authenticated_identity_from_api_body(
    body: bytes,
) -> tuple[bytes, bytes] | None:
    """Return the two bounded numeric identity fields from one API body."""

    unique_match = UNIQUE_ACCOUNT_ID_PATTERN.search(body)
    crossregion_match = CROSSREGION_IDENTIFIER_PATTERN.search(body)
    if unique_match is None or crossregion_match is None:
        return None
    return unique_match.group(1), crossregion_match.group(1)


def _canonical_satanic_zone_body(
    unique_account_id: bytes,
    crossregion_identifier: bytes,
) -> bytes:
    identity = _authenticated_identity_from_api_body(
        b"unique_account_id="
        + unique_account_id
        + b"&crossregion_identifier="
        + crossregion_identifier
    )
    if identity != (unique_account_id, crossregion_identifier):
        raise ValueError("Invalid in-memory Satanic Zone request identity.")
    return (
        PRODUCT_REQUEST_BODY_PREFIX
        + b"satanic_zone_get\x00"
        + PRODUCT_REQUEST_ROUTE_MARKER
        + b"unique_account_id="
        + unique_account_id
        + b"&crossregion_identifier="
        + crossregion_identifier
        + b"&beta=0"
        + b"\x00"
    )


def _state_protocol_fields() -> dict[str, object]:
    return {
        "schemaVersion": 2 if PRODUCT_RELAY_MODE else 1,
        "mode": "product" if PRODUCT_RELAY_MODE else "research_one_shot",
        "sessionId": PRODUCT_SESSION_ID if PRODUCT_RELAY_MODE else WIRE_SESSION_ID,
    }


def _utc_after_seconds(seconds: float) -> str:
    return (
        datetime.now(timezone.utc) + timedelta(seconds=seconds)
    ).isoformat().replace("+00:00", "Z")


def _validate_wire_session(target_port: int) -> tuple[bool, dict[str, bool]]:
    marker = read_json(STATE_DIR / WIRE_SESSION_FILE)
    marker_present = marker is not None
    schema_valid = bool(
        marker
        and not isinstance(marker.get("schemaVersion"), bool)
        and marker.get("schemaVersion") == 1
    )
    status_active = bool(marker and marker.get("status") == "active")
    session_matches = bool(
        marker
        and WIRE_SESSION_ID
        and isinstance(marker.get("sessionId"), str)
        and marker.get("sessionId") == WIRE_SESSION_ID
    )
    raw_pid = marker.get("pid") if marker else None
    pid_valid = (
        not isinstance(raw_pid, bool)
        and isinstance(raw_pid, int)
        and raw_pid > 0
    )
    capture_process_alive = bool(pid_valid and process_is_alive(raw_pid))
    raw_ports = marker.get("ports") if marker else None
    ports_valid = bool(
        isinstance(raw_ports, list)
        and raw_ports
        and all(
            not isinstance(port, bool) and isinstance(port, int) and 0 < port <= 65535
            for port in raw_ports
        )
    )
    target_covered = bool(
        ports_valid
        and target_port in raw_ports
        and target_port in WIRE_CONFIRMATION_PORTS
    )
    evidence = {
        "wireSessionMarkerPresent": marker_present,
        "wireSessionSchemaValid": schema_valid,
        "wireSessionStatusActive": status_active,
        "wireSessionIdMatched": session_matches,
        "wireCaptureProcessAlive": capture_process_alive,
        "targetCoveredByWireSession": target_covered,
    }
    return all(evidence.values()), evidence


def _zone_response_before_native(attempt: InjectionAttempt) -> bool | None:
    if attempt.zone_response_at is None:
        return None
    return (
        attempt.native_client_payload_at is None
        or attempt.zone_response_at < attempt.native_client_payload_at
    )


def _native_before_zone_response(attempt: InjectionAttempt) -> bool | None:
    if attempt.native_client_payload_at is None:
        return None
    if attempt.zone_response_at is None:
        return True
    return attempt.native_client_payload_at < attempt.zone_response_at


def _attempt_classification(attempt: InjectionAttempt) -> str:
    if attempt.terminal_inconclusive:
        return "inconclusive"
    if _zone_response_before_native(attempt):
        return "conclusive_positive"
    if (
        attempt.zone_response_seen
        or attempt.timed_out
        or attempt.stable_logged
        or attempt.flow_closed
        or attempt.dispatch_outcome_uncertain
    ):
        return "inconclusive"
    return "pending"


def _server_endpoint(flow: tcp.TCPFlow) -> tuple[str, int] | None:
    address: Any = flow.server_conn.address or flow.server_conn.peername
    if not address or len(address) < 2:
        return None
    try:
        return str(address[0]), int(address[1])
    except (TypeError, ValueError):
        return None


def _safe_flow_id(flow_id: str) -> str:
    return hashlib.sha256(str(flow_id).encode("utf-8")).hexdigest()[:12]


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


addons = [SatanicZoneRelayAddon()]
