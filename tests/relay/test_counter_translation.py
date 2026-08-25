from __future__ import annotations

from pathlib import Path
import sys

RELAY_DIR = Path(__file__).resolve().parents[2] / "resources" / "satanic-zone-relay"
sys.path.insert(0, str(RELAY_DIR))

import unittest
from unittest.mock import patch

from counter_translation import OutboundApiCounterTranslator
from sz_frame import (
    TOKEN_BYTES,
    build_frame,
    build_generic_frame,
    computed_generic_token,
    computed_request_token,
    matching_frame_counters,
    parse_frame,
    parse_generic_frame,
)


def api_frame(body: bytes, counter: int) -> bytes:
    frame = build_frame(body, computed_request_token(body, counter))
    if matching_frame_counters(parse_frame(frame)) != (counter,):
        raise AssertionError("API fixture counter is not unique.")
    return frame


def generic_frame(body: bytes, counter: int) -> bytes:
    frame = build_generic_frame(body, computed_generic_token(body, counter))
    if matching_frame_counters(parse_generic_frame(frame)) != (counter,):
        raise AssertionError("Generic fixture counter is not unique.")
    return frame


class OutboundApiCounterTranslatorTests(unittest.TestCase):
    def test_complete_api_frame_is_resigned_without_changing_length_or_body(self) -> None:
        body = b"complete-api-frame"
        original = api_frame(body, 42)
        translator = OutboundApiCounterTranslator(initial_client_counter=41)

        result = translator.feed(original)

        self.assertEqual(len(result.forwarded_content), len(original))
        self.assertEqual(result.forwarded_content[TOKEN_BYTES:], original[TOKEN_BYTES:])
        self.assertEqual(matching_frame_counters(parse_frame(result.forwarded_content)), (43,))
        self.assertEqual(result.translated_api_frames, 1)
        self.assertEqual(result.buffered_byte_length, 0)
        self.assertIsNone(result.failure_reason)

    def test_fragmented_frame_is_withheld_until_complete_then_forwarded_once(self) -> None:
        original = api_frame(b"fragmented-api-frame", 101)
        translator = OutboundApiCounterTranslator(initial_client_counter=100)

        first = translator.feed(original[:5])
        second = translator.feed(original[5:15])
        third = translator.feed(original[15:])

        self.assertEqual(first.forwarded_content, b"")
        self.assertEqual(second.forwarded_content, b"")
        self.assertEqual(first.buffered_byte_length, 5)
        self.assertEqual(second.buffered_byte_length, 15)
        self.assertEqual(len(third.forwarded_content), len(original))
        self.assertEqual(matching_frame_counters(parse_frame(third.forwarded_content)), (102,))
        self.assertEqual(third.forwarded_content[TOKEN_BYTES:], original[TOKEN_BYTES:])
        self.assertEqual(translator.buffered_bytes, 0)

    def test_coalesced_generic_frame_is_unchanged_and_outside_api_sequence(self) -> None:
        first = api_frame(b"coalesced-api-one", 21)
        generic = generic_frame(b"coalesced-generic", 199)
        second = api_frame(b"coalesced-api-two", 22)
        translator = OutboundApiCounterTranslator(initial_client_counter=20)

        result = translator.feed(first + generic + second)

        first_out = result.forwarded_content[: len(first)]
        generic_out = result.forwarded_content[len(first) : len(first) + len(generic)]
        second_out = result.forwarded_content[len(first) + len(generic) :]
        self.assertEqual(matching_frame_counters(parse_frame(first_out)), (22,))
        self.assertEqual(generic_out, generic)
        self.assertEqual(matching_frame_counters(parse_generic_frame(generic_out)), (199,))
        self.assertEqual(matching_frame_counters(parse_frame(second_out)), (23,))
        self.assertEqual(result.translated_api_frames, 2)
        self.assertEqual(result.translated_generic_frames, 0)
        self.assertEqual(translator.translated_generic_frame_count, 0)
        self.assertEqual(len(result.forwarded_content), len(first + generic + second))

    def test_complete_prefix_is_forwarded_while_fragmented_tail_remains_buffered(self) -> None:
        complete = api_frame(b"complete-prefix", 31)
        tail = api_frame(b"fragmented-tail", 32)
        translator = OutboundApiCounterTranslator(initial_client_counter=30)

        first = translator.feed(complete + tail[:9])
        second = translator.feed(tail[9:])

        self.assertEqual(len(first.forwarded_content), len(complete))
        self.assertEqual(first.buffered_byte_length, 9)
        self.assertEqual(matching_frame_counters(parse_frame(first.forwarded_content)), (32,))
        self.assertEqual(len(second.forwarded_content), len(tail))
        self.assertEqual(matching_frame_counters(parse_frame(second.forwarded_content)), (33,))
        self.assertEqual(second.buffered_byte_length, 0)

    def test_counter_translation_wraps_modulo_256(self) -> None:
        before_wrap = api_frame(b"before-wrap", 255)
        after_wrap = api_frame(b"after-wrap", 0)
        translator = OutboundApiCounterTranslator(initial_client_counter=254)

        result = translator.feed(before_wrap + after_wrap)

        first_out = result.forwarded_content[: len(before_wrap)]
        second_out = result.forwarded_content[len(before_wrap) :]
        self.assertEqual(matching_frame_counters(parse_frame(first_out)), (0,))
        self.assertEqual(matching_frame_counters(parse_frame(second_out)), (1,))

    def test_dispatch_offset_advances_without_losing_client_sequence(self) -> None:
        anchor = api_frame(b"second-dispatch-anchor", 41)
        later = api_frame(b"after-second-dispatch", 42)
        translator = OutboundApiCounterTranslator(
            initial_client_counter=40,
            counter_offset=1,
        )

        anchor_result = translator.feed(anchor)
        next_offset = translator.advance_offset_after_dispatch(41)
        later_result = translator.feed(later)

        self.assertEqual(
            matching_frame_counters(parse_frame(anchor_result.forwarded_content)),
            (42,),
        )
        self.assertEqual(next_offset, 2)
        self.assertEqual(translator.counter_offset, 2)
        self.assertEqual(translator.last_client_counter, 42)
        self.assertEqual(
            matching_frame_counters(parse_frame(later_result.forwarded_content)),
            (44,),
        )

    def test_dispatch_offset_advance_rejects_wrong_or_incomplete_anchor(self) -> None:
        frame = api_frame(b"partial-anchor", 11)
        translator = OutboundApiCounterTranslator(initial_client_counter=10)

        translator.feed(frame[:6])
        with self.assertRaises(RuntimeError):
            translator.advance_offset_after_dispatch(10)

        translator.feed(frame[6:])
        with self.assertRaises(RuntimeError):
            translator.advance_offset_after_dispatch(12)

    def test_unaccounted_bytes_fail_closed_and_all_later_bytes_are_withheld(self) -> None:
        translator = OutboundApiCounterTranslator(initial_client_counter=10)

        failure = translator.feed(b"!not-a-frame")
        later = translator.feed(api_frame(b"later-valid-frame", 11))

        self.assertTrue(translator.failed)
        self.assertEqual(failure.failure_reason, "unaccounted_outbound_bytes")
        self.assertTrue(failure.failure_new)
        self.assertEqual(failure.forwarded_content, b"")
        self.assertEqual(failure.withheld_byte_length, len(b"!not-a-frame"))
        self.assertEqual(later.forwarded_content, b"")
        self.assertEqual(later.failure_reason, "unaccounted_outbound_bytes")

    def test_discontinuous_client_counter_fails_closed_without_forwarding_frame(self) -> None:
        discontinuous = api_frame(b"counter-gap", 52)
        translator = OutboundApiCounterTranslator(initial_client_counter=50)

        result = translator.feed(discontinuous)

        self.assertEqual(result.failure_reason, "frame_counter_sequence_discontinuous")
        self.assertEqual(result.forwarded_content, b"")
        self.assertEqual(result.withheld_byte_length, len(discontinuous))
        self.assertEqual(translator.translated_api_frame_count, 0)

    def test_ambiguous_counter_fails_closed(self) -> None:
        frame = api_frame(b"ambiguous-counter", 8)
        translator = OutboundApiCounterTranslator(initial_client_counter=7)

        with patch("counter_translation.matching_frame_counters", return_value=(8, 9)):
            result = translator.feed(frame)

        self.assertEqual(result.failure_reason, "ambiguous_frame_counter")
        self.assertEqual(result.forwarded_content, b"")
        self.assertEqual(result.withheld_byte_length, len(frame))

    def test_unverified_counter_fails_closed(self) -> None:
        frame = api_frame(b"unverified-counter", 8)
        translator = OutboundApiCounterTranslator(initial_client_counter=7)

        with patch("counter_translation.matching_frame_counters", return_value=()):
            result = translator.feed(frame)

        self.assertEqual(result.failure_reason, "unverified_frame_counter")
        self.assertEqual(result.forwarded_content, b"")
        self.assertEqual(result.withheld_byte_length, len(frame))

    def test_reconnect_uses_fresh_translation_state(self) -> None:
        old = OutboundApiCounterTranslator(initial_client_counter=90)
        self.assertTrue(old.feed(api_frame(b"old-gap", 92)).failure_new)

        replacement = OutboundApiCounterTranslator(initial_client_counter=200)
        result = replacement.feed(api_frame(b"replacement-flow", 201))

        self.assertFalse(replacement.failed)
        self.assertEqual(matching_frame_counters(parse_frame(result.forwarded_content)), (202,))
        self.assertEqual(replacement.translated_api_frame_count, 1)

    def test_constructor_rejects_non_u8_state(self) -> None:
        for value in (-1, 256, True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                OutboundApiCounterTranslator(value)  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
