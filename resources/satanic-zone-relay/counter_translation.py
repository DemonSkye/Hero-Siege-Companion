from __future__ import annotations

from dataclasses import dataclass

from sz_frame import (
    TOKEN_BYTES,
    OutboundFrameStreamDecoder,
    ParsedFrame,
    UnaccountedOutboundBytes,
    computed_request_token,
    matching_frame_counters,
)


@dataclass(frozen=True)
class CounterTranslationResult:
    forwarded_content: bytes
    buffered_byte_length: int
    translated_api_frames: int = 0
    translated_generic_frames: int = 0
    failure_reason: str | None = None
    failure_new: bool = False
    withheld_byte_length: int = 0


class OutboundApiCounterTranslator:
    """Buffer client chunks and re-sign only complete API frames.

    The game keeps the API client's counter on that client instance. No verified
    evidence shows that generic frames share it, so generic frames are forwarded
    byte-for-byte and do not participate in API continuity. Once active, the
    translator still fails closed on unattributable stream bytes or an API frame
    whose counter cannot be recovered uniquely. Reconnecting must create a fresh
    translator instance after any failure.
    """

    def __init__(self, initial_client_counter: int, counter_offset: int = 1) -> None:
        self._validate_counter(initial_client_counter)
        self._validate_counter(counter_offset)
        self._last_client_counter = initial_client_counter
        self._counter_offset = counter_offset
        self._decoder = OutboundFrameStreamDecoder()
        self._pending_input_bytes = 0
        self._failure_reason: str | None = None
        self.translated_api_frame_count = 0
        self.translated_generic_frame_count = 0
        self.withheld_byte_count = 0

    @property
    def buffered_bytes(self) -> int:
        return self._pending_input_bytes

    @property
    def failed(self) -> bool:
        return self._failure_reason is not None

    @property
    def failure_reason(self) -> str | None:
        return self._failure_reason

    @property
    def counter_offset(self) -> int:
        return self._counter_offset

    @property
    def last_client_counter(self) -> int:
        return self._last_client_counter

    def advance_offset_after_dispatch(self, anchor_client_counter: int) -> int:
        """Commit one additional injected API counter at a complete boundary."""

        self._validate_counter(anchor_client_counter)
        if self.failed:
            raise RuntimeError("Cannot advance a failed counter translator.")
        if self._pending_input_bytes:
            raise RuntimeError("Cannot advance while a native frame is incomplete.")
        if self._last_client_counter != anchor_client_counter:
            raise RuntimeError("Translated anchor does not match the dispatch anchor.")
        self._counter_offset = (self._counter_offset + 1) % 256
        return self._counter_offset

    def feed(self, chunk: bytes) -> CounterTranslationResult:
        content = bytes(chunk)
        if self.failed:
            self.withheld_byte_count += len(content)
            return CounterTranslationResult(
                forwarded_content=b"",
                buffered_byte_length=0,
                failure_reason=self._failure_reason,
                withheld_byte_length=len(content),
            )
        if not content:
            return CounterTranslationResult(
                forwarded_content=b"",
                buffered_byte_length=self._pending_input_bytes,
            )

        self._pending_input_bytes += len(content)
        forwarded = bytearray()
        translated_api_frames = 0
        translated_generic_frames = 0

        for decoded in self._decoder.feed(content):
            if isinstance(decoded, UnaccountedOutboundBytes):
                return self._fail(
                    "unaccounted_outbound_bytes",
                    bytes(forwarded),
                    translated_api_frames,
                    translated_generic_frames,
                )

            if decoded.framing == "generic":
                forwarded.extend(decoded.raw)
                self._pending_input_bytes -= len(decoded.raw)
                if self._pending_input_bytes < 0:
                    return self._fail(
                        "translation_accounting_underflow",
                        b"",
                        translated_api_frames,
                        translated_generic_frames,
                    )
                continue

            matches = matching_frame_counters(decoded)
            if not matches:
                return self._fail(
                    "unverified_frame_counter",
                    bytes(forwarded),
                    translated_api_frames,
                    translated_generic_frames,
                )
            if len(matches) != 1:
                return self._fail(
                    "ambiguous_frame_counter",
                    bytes(forwarded),
                    translated_api_frames,
                    translated_generic_frames,
                )

            client_counter = matches[0]
            expected_client_counter = (self._last_client_counter + 1) % 256
            if client_counter != expected_client_counter:
                return self._fail(
                    "frame_counter_sequence_discontinuous",
                    bytes(forwarded),
                    translated_api_frames,
                    translated_generic_frames,
                )
            server_counter = (client_counter + self._counter_offset) % 256
            translated = self._resign_frame(decoded, server_counter)
            forwarded.extend(translated)
            self._last_client_counter = client_counter
            translated_api_frames += 1
            self.translated_api_frame_count += 1

            self._pending_input_bytes -= len(decoded.raw)
            if self._pending_input_bytes < 0:
                return self._fail(
                    "translation_accounting_underflow",
                    b"",
                    translated_api_frames,
                    translated_generic_frames,
                )

        return CounterTranslationResult(
            forwarded_content=bytes(forwarded),
            buffered_byte_length=self._pending_input_bytes,
            translated_api_frames=translated_api_frames,
            translated_generic_frames=translated_generic_frames,
        )

    def halt(self, reason: str) -> CounterTranslationResult:
        if self.failed:
            return CounterTranslationResult(
                forwarded_content=b"",
                buffered_byte_length=0,
                failure_reason=self._failure_reason,
            )
        return self._fail(reason, b"", 0, 0)

    def _fail(
        self,
        reason: str,
        forwarded_content: bytes,
        translated_api_frames: int,
        translated_generic_frames: int,
    ) -> CounterTranslationResult:
        self._failure_reason = reason
        withheld_byte_length = self._pending_input_bytes
        self.withheld_byte_count += withheld_byte_length
        self._pending_input_bytes = 0
        return CounterTranslationResult(
            forwarded_content=forwarded_content,
            buffered_byte_length=0,
            translated_api_frames=translated_api_frames,
            translated_generic_frames=translated_generic_frames,
            failure_reason=reason,
            failure_new=True,
            withheld_byte_length=withheld_byte_length,
        )

    @staticmethod
    def _resign_frame(parsed: ParsedFrame, counter: int) -> bytes:
        if parsed.framing != "api":
            raise AssertionError("Counter translation only re-signs API frames.")
        token_bytes = TOKEN_BYTES
        token = computed_request_token(parsed.body, counter)
        translated = token + parsed.raw[token_bytes:]
        if (
            len(translated) != len(parsed.raw)
            or translated[token_bytes:] != parsed.raw[token_bytes:]
        ):
            raise AssertionError("Counter translation must preserve frame length and body bytes.")
        return translated

    @staticmethod
    def _validate_counter(value: int) -> None:
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 255:
            raise ValueError("Counter translation values must be unsigned bytes.")
