from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import json
import re
import secrets
import struct
from typing import Any, Callable


TOKEN_BYTES = 12
HEADER_BYTES = TOKEN_BYTES + 4
GENERIC_TOKEN_BYTES = 4
GENERIC_HEADER_BYTES = GENERIC_TOKEN_BYTES + 4
MAX_BODY_BYTES = 64 * 1024
MAX_BUFFER_BYTES = 1024 * 1024
SATANIC_ZONE_ROUTE = b"satanic_zone_get"
TOKEN_PATTERN = re.compile(rb"[0-9a-f]{12}", re.IGNORECASE)
GENERIC_TOKEN_PATTERN = re.compile(rb"[0-9a-f]{4}", re.IGNORECASE)
ZONE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.: -]{1,64}$")
UTC_TIMESTAMP_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$"
)


class FrameError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedFrame:
    raw: bytes
    token: bytes
    body: bytes
    framing: str = "api"

    @property
    def body_length(self) -> int:
        return len(self.body)

    @property
    def is_satanic_zone_request(self) -> bool:
        return self.framing == "api" and SATANIC_ZONE_ROUTE in self.body


@dataclass(frozen=True)
class UnaccountedOutboundBytes:
    byte_length: int


def build_frame(body: bytes, token: bytes | None = None) -> bytes:
    _validate_body(body)
    next_token = token or secrets.token_hex(TOKEN_BYTES // 2).encode("ascii")
    _validate_token(next_token)
    return next_token + struct.pack("<I", len(body)) + body


def build_generic_frame(body: bytes, token: bytes | None = None) -> bytes:
    _validate_body(body)
    next_token = token or secrets.token_hex(GENERIC_TOKEN_BYTES // 2).encode("ascii")
    _validate_token(next_token, GENERIC_TOKEN_BYTES)
    return next_token + struct.pack("<I", len(body)) + body


def computed_request_token(body: bytes, counter: int) -> bytes:
    """Return the current-build API token for a body and unsigned-byte counter."""
    _validate_body(body)
    _validate_counter(counter)
    return _computed_token(body, counter, TOKEN_BYTES)


def computed_generic_token(body: bytes, counter: int) -> bytes:
    """Return the current-build generic token for a body and unsigned-byte counter."""
    return _computed_token(body, counter, GENERIC_TOKEN_BYTES)


def recover_frame_counter(raw: bytes) -> int | None:
    """Recover a uniquely matching u8 counter by exhaustively testing 0..255."""
    parsed = parse_frame(raw)
    return recover_parsed_frame_counter(parsed)


def recover_generic_frame_counter(raw: bytes) -> int | None:
    return recover_parsed_frame_counter(parse_generic_frame(raw))


def recover_parsed_frame_counter(parsed: ParsedFrame) -> int | None:
    matches = matching_frame_counters(parsed)
    return matches[0] if len(matches) == 1 else None


def matching_frame_counters(parsed: ParsedFrame) -> tuple[int, ...]:
    token_bytes = TOKEN_BYTES if parsed.framing == "api" else GENERIC_TOKEN_BYTES
    return tuple(
        counter
        for counter in range(256)
        if hmac.compare_digest(
            _computed_token(parsed.body, counter, token_bytes),
            parsed.token.lower(),
        )
    )


def build_computed_satanic_zone_request(raw: bytes, counter: int) -> bytes:
    """Rebuild a captured SZ request body using the current-build API token."""
    parsed = parse_frame(raw)
    if not parsed.is_satanic_zone_request:
        raise FrameError("Captured frame is not a satanic_zone_get request.")
    return build_frame(parsed.body, computed_request_token(parsed.body, counter))


def parse_frame(raw: bytes) -> ParsedFrame:
    if len(raw) < HEADER_BYTES:
        raise FrameError("Frame is shorter than its token and length header.")
    token = raw[:TOKEN_BYTES]
    _validate_token(token)
    body_length = struct.unpack_from("<I", raw, TOKEN_BYTES)[0]
    if body_length <= 0 or body_length > MAX_BODY_BYTES:
        raise FrameError("Frame body length is outside the supported POC bounds.")
    if len(raw) != HEADER_BYTES + body_length:
        raise FrameError("Frame byte length does not match its little-endian body length.")
    return ParsedFrame(raw=raw, token=token, body=raw[HEADER_BYTES:])


def parse_generic_frame(raw: bytes) -> ParsedFrame:
    if len(raw) < GENERIC_HEADER_BYTES:
        raise FrameError("Generic frame is shorter than its token and length header.")
    token = raw[:GENERIC_TOKEN_BYTES]
    _validate_token(token, GENERIC_TOKEN_BYTES)
    body_length = struct.unpack_from("<I", raw, GENERIC_TOKEN_BYTES)[0]
    if body_length <= 0 or body_length > MAX_BODY_BYTES:
        raise FrameError("Frame body length is outside the supported POC bounds.")
    if len(raw) != GENERIC_HEADER_BYTES + body_length:
        raise FrameError("Frame byte length does not match its little-endian body length.")
    return ParsedFrame(
        raw=raw,
        token=token,
        body=raw[GENERIC_HEADER_BYTES:],
        framing="generic",
    )


def freshen_request_token(
    raw: bytes,
    token_factory: Callable[[], bytes] | None = None,
) -> bytes:
    parsed = parse_frame(raw)
    if not parsed.is_satanic_zone_request:
        raise FrameError("Captured frame is not a satanic_zone_get request.")
    factory = token_factory or (lambda: secrets.token_hex(TOKEN_BYTES // 2).encode("ascii"))
    next_token = factory()
    _validate_token(next_token)
    if next_token.lower() == parsed.token.lower():
        raise FrameError("Fresh request token unexpectedly matches the captured token.")
    return next_token + raw[TOKEN_BYTES:]


def request_token_analysis(
    raw: bytes,
    previous_token: bytes | None = None,
    prior_server_payload: bytes | None = None,
) -> dict[str, object]:
    parsed = parse_frame(raw)
    body_digests = {
        "md5": hashlib.md5(parsed.body).hexdigest(),
        "sha1": hashlib.sha1(parsed.body).hexdigest(),
        "sha256": hashlib.sha256(parsed.body).hexdigest(),
    }
    digest_edges = [
        f"{name}:prefix"
        for name, digest in body_digests.items()
        if parsed.token.lower() == digest[:TOKEN_BYTES].encode("ascii")
    ]
    digest_edges.extend(
        f"{name}:suffix"
        for name, digest in body_digests.items()
        if parsed.token.lower() == digest[-TOKEN_BYTES:].encode("ascii")
    )

    repeated_previous = False
    changed_hex_characters: int | None = None
    bit_distance: int | None = None
    if previous_token is not None:
        _validate_token(previous_token)
        current = parsed.token.lower()
        previous = previous_token.lower()
        repeated_previous = current == previous
        changed_hex_characters = sum(1 for left, right in zip(current, previous) if left != right)
        bit_distance = _bit_distance(current, previous)

    return {
        "seenInPriorServerPayload": bool(prior_server_payload and parsed.token in prior_server_payload),
        "repeatedPreviousToken": repeated_previous,
        "changedHexCharactersFromPrevious": changed_hex_characters,
        "bitDistanceFromPrevious": bit_distance,
        "matchingBodyDigestEdges": digest_edges,
    }


def frame_summary(raw: bytes) -> dict[str, object]:
    return parsed_frame_summary(parse_frame(raw))


def parsed_frame_summary(parsed: ParsedFrame) -> dict[str, object]:
    return {
        "byteLength": len(parsed.raw),
        "bodyLength": parsed.body_length,
        "nullBytes": parsed.raw.count(0),
        "sha256": hashlib.sha256(parsed.raw).hexdigest(),
        "tokenHash": hashlib.sha256(parsed.token.lower()).hexdigest()[:12],
        "routeMatched": parsed.is_satanic_zone_request,
        "framing": parsed.framing,
    }


def response_signals(payload: bytes) -> dict[str, bool]:
    normalized = payload.lower().replace(b"_", b"")
    return {
        "zoneName": b"sataniczonename" in normalized,
        "buffs": b"buffs" in normalized or b"zonebuffs" in normalized,
        "debuffs": b"debuffs" in normalized or b"zonedebuffs" in normalized,
    }


def sanitized_zone_observation(payload: bytes, observed_at: str) -> dict[str, object] | None:
    """Extract only display-safe SZ fields from a possibly framed response buffer."""
    if not isinstance(observed_at, str) or not UTC_TIMESTAMP_PATTERN.fullmatch(observed_at):
        return None

    text = payload.decode("utf-8", errors="ignore")
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text):
        try:
            candidate, _ = decoder.raw_decode(text[match.start() :])
        except (json.JSONDecodeError, ValueError):
            continue
        zone = _find_zone_mapping(candidate)
        if zone is None:
            continue

        raw_zone = _bounded_zone_name(_mapping_value(zone, "satanicZoneName", "satanic_zone_name"))
        raw_buffs = _mapping_value(zone, "buffs", "zone_buffs")
        raw_debuffs = _mapping_value(zone, "debuffs", "zone_debuffs")
        if raw_zone is None or raw_buffs is None or raw_debuffs is None:
            continue
        buffs = _effect_ids(raw_buffs)
        debuffs = _effect_ids(raw_debuffs)
        if buffs is None or debuffs is None:
            continue
        return {
            "schemaVersion": 1,
            "rawZone": raw_zone,
            "buffs": buffs,
            "debuffs": debuffs,
            "observedAt": observed_at,
        }
    return None


def _find_zone_mapping(value: object) -> dict[str, Any] | None:
    pending = [value]
    inspected = 0
    while pending and inspected < 256:
        current = pending.pop()
        inspected += 1
        if isinstance(current, dict):
            if any(key in current for key in ("satanicZoneName", "satanic_zone_name")):
                return current
            pending.extend(reversed(list(current.values())))
        elif isinstance(current, list):
            pending.extend(reversed(current))
    return None


def _mapping_value(mapping: dict[str, Any], *keys: str) -> object | None:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def _bounded_zone_name(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized if ZONE_NAME_PATTERN.fullmatch(normalized) else None


def _effect_ids(value: object) -> list[int] | None:
    values: list[object]
    if isinstance(value, str):
        values = [entry.strip() for entry in value.replace(",", "|").split("|") if entry.strip()]
    elif isinstance(value, list):
        values = value
    else:
        return None

    result: list[int] = []
    for entry in values:
        if isinstance(entry, bool):
            return None
        if isinstance(entry, int):
            effect_id = entry
        elif isinstance(entry, str) and re.fullmatch(r"\d{1,4}", entry):
            effect_id = int(entry)
        else:
            return None
        if effect_id <= 0 or effect_id > 4096:
            return None
        if effect_id not in result:
            result.append(effect_id)
        if len(result) > 32:
            return None
    return result


class OutboundFrameStreamDecoder:
    """Strictly decode both current-build outbound framings without hiding gaps."""

    def __init__(self) -> None:
        self._buffer = bytearray()
        self.discarded_bytes = 0
        self._at_verified_boundary = True

    @property
    def buffered_bytes(self) -> int:
        return len(self._buffer)

    def feed(self, chunk: bytes) -> list[ParsedFrame | UnaccountedOutboundBytes]:
        if not chunk:
            return []
        events: list[ParsedFrame | UnaccountedOutboundBytes] = []
        self._buffer.extend(chunk)
        if len(self._buffer) > MAX_BUFFER_BYTES:
            overflow = len(self._buffer) - MAX_BUFFER_BYTES
            self._discard_unaccounted(overflow, events)
            self._at_verified_boundary = False

        while self._buffer:
            if self._at_verified_boundary:
                candidate = self._candidate_at(0)
                if candidate is None:
                    break
                if candidate is not False and matching_frame_counters(candidate):
                    del self._buffer[: len(candidate.raw)]
                    events.append(candidate)
                    continue
                self._discard_unaccounted(1, events)
                self._at_verified_boundary = False
                continue

            recovered = self._find_verified_candidate()
            if recovered is not None:
                offset, candidate = recovered
                self._discard_unaccounted(offset, events)
                del self._buffer[: len(candidate.raw)]
                events.append(candidate)
                self._at_verified_boundary = True
                continue

            incomplete_offset = self._first_incomplete_candidate_offset()
            if incomplete_offset is not None:
                self._discard_unaccounted(incomplete_offset, events)
                break
            self._discard_unaccounted(len(self._buffer), events)
        return events

    def _candidate_at(self, offset: int) -> ParsedFrame | bool | None:
        available = len(self._buffer) - offset
        token_prefix = bytes(
            self._buffer[offset : offset + min(available, GENERIC_TOKEN_BYTES)]
        )
        if not _is_hex_ascii(token_prefix):
            return False
        if available < GENERIC_HEADER_BYTES:
            return None

        generic_body_length = struct.unpack_from(
            "<I",
            self._buffer,
            offset + GENERIC_TOKEN_BYTES,
        )[0]
        if 0 < generic_body_length <= MAX_BODY_BYTES:
            frame_length = GENERIC_HEADER_BYTES + generic_body_length
            if available < frame_length:
                return None
            return parse_generic_frame(bytes(self._buffer[offset : offset + frame_length]))

        api_token_prefix = bytes(self._buffer[offset : offset + min(available, TOKEN_BYTES)])
        if not _is_hex_ascii(api_token_prefix):
            return False
        if available < HEADER_BYTES:
            return None
        api_body_length = struct.unpack_from("<I", self._buffer, offset + TOKEN_BYTES)[0]
        if not 0 < api_body_length <= MAX_BODY_BYTES:
            return False
        frame_length = HEADER_BYTES + api_body_length
        if available < frame_length:
            return None
        return parse_frame(bytes(self._buffer[offset : offset + frame_length]))

    def _find_verified_candidate(self) -> tuple[int, ParsedFrame] | None:
        for offset in range(len(self._buffer)):
            candidate = self._candidate_at(offset)
            if (
                candidate is not None
                and candidate is not False
                and matching_frame_counters(candidate)
            ):
                return offset, candidate
        return None

    def _first_incomplete_candidate_offset(self) -> int | None:
        for offset in range(len(self._buffer)):
            if self._candidate_at(offset) is None:
                return offset
        return None

    def _discard_unaccounted(
        self,
        length: int,
        events: list[ParsedFrame | UnaccountedOutboundBytes],
    ) -> None:
        if length <= 0:
            return
        del self._buffer[:length]
        self.discarded_bytes += length
        if events and isinstance(events[-1], UnaccountedOutboundBytes):
            previous = events[-1]
            events[-1] = UnaccountedOutboundBytes(previous.byte_length + length)
        else:
            events.append(UnaccountedOutboundBytes(length))


class FrameStreamDecoder:
    def __init__(self, required_marker: bytes | None = None) -> None:
        self._buffer = bytearray()
        self._required_marker = required_marker
        self.discarded_bytes = 0

    @property
    def buffered_bytes(self) -> int:
        return len(self._buffer)

    def feed(self, chunk: bytes) -> list[ParsedFrame]:
        if not chunk:
            return []
        self._buffer.extend(chunk)
        if len(self._buffer) > MAX_BUFFER_BYTES:
            overflow = len(self._buffer) - MAX_BUFFER_BYTES
            del self._buffer[:overflow]
            self.discarded_bytes += overflow

        frames: list[ParsedFrame] = []
        while self._buffer:
            matching_complete: tuple[int, int, ParsedFrame] | None = None
            other_complete: tuple[int, int, ParsedFrame] | None = None
            first_incomplete: int | None = None

            for offset in range(max(len(self._buffer) - TOKEN_BYTES + 1, 0)):
                if TOKEN_PATTERN.fullmatch(self._buffer[offset : offset + TOKEN_BYTES]) is None:
                    continue
                remaining = len(self._buffer) - offset
                if remaining < HEADER_BYTES:
                    first_incomplete = offset if first_incomplete is None else min(first_incomplete, offset)
                    continue

                body_length = struct.unpack_from("<I", self._buffer, offset + TOKEN_BYTES)[0]
                if body_length <= 0 or body_length > MAX_BODY_BYTES:
                    continue
                frame_length = HEADER_BYTES + body_length
                if remaining < frame_length:
                    first_incomplete = offset if first_incomplete is None else min(first_incomplete, offset)
                    continue

                parsed = parse_frame(bytes(self._buffer[offset : offset + frame_length]))
                candidate = (offset, frame_length, parsed)
                if self._required_marker is None or self._required_marker in parsed.body:
                    matching_complete = candidate
                    break
                if other_complete is None:
                    other_complete = candidate

            complete = matching_complete or other_complete
            if complete is not None:
                offset, frame_length, parsed = complete
                self._discard_prefix(offset)
                del self._buffer[:frame_length]
                if self._required_marker is None or self._required_marker in parsed.body:
                    frames.append(parsed)
                continue

            if first_incomplete is not None:
                self._discard_prefix(first_incomplete)
                break

            if len(self._buffer) < TOKEN_BYTES:
                break
            match = TOKEN_PATTERN.search(self._buffer)
            if match is None:
                keep = min(len(self._buffer), TOKEN_BYTES - 1)
                self._discard_prefix(len(self._buffer) - keep)
                break
            self._discard_prefix(max(match.start(), 1))
        return frames

    def _discard_prefix(self, length: int) -> None:
        if length <= 0:
            return
        del self._buffer[:length]
        self.discarded_bytes += length


def _validate_token(token: bytes, expected_bytes: int = TOKEN_BYTES) -> None:
    pattern = TOKEN_PATTERN if expected_bytes == TOKEN_BYTES else GENERIC_TOKEN_PATTERN
    if len(token) != expected_bytes or pattern.fullmatch(token) is None:
        raise FrameError(
            f"Request token must be exactly {expected_bytes} hexadecimal ASCII bytes."
        )


def _validate_body(body: bytes) -> None:
    if not body or len(body) > MAX_BODY_BYTES:
        raise FrameError("Frame body length is outside the supported POC bounds.")


def _validate_counter(counter: int) -> None:
    if isinstance(counter, bool) or not isinstance(counter, int) or not 0 <= counter <= 255:
        raise FrameError("Packet counter must be an unsigned byte.")


def _computed_token(body: bytes, counter: int, token_bytes: int) -> bytes:
    _validate_body(body)
    _validate_counter(counter)
    digest = hashlib.md5(body + bytes((counter,))).hexdigest()
    return digest[:token_bytes].encode("ascii")


def _is_hex_ascii(value: bytes) -> bool:
    return all(
        ord("0") <= byte <= ord("9")
        or ord("a") <= byte <= ord("f")
        or ord("A") <= byte <= ord("F")
        for byte in value
    )


def _bit_distance(left: bytes, right: bytes) -> int:
    return sum((int(chr(a), 16) ^ int(chr(b), 16)).bit_count() for a, b in zip(left, right))
