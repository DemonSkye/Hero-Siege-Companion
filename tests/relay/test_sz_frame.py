from __future__ import annotations

from pathlib import Path
import sys

RELAY_DIR = Path(__file__).resolve().parents[2] / "resources" / "satanic-zone-relay"
sys.path.insert(0, str(RELAY_DIR))

import unittest
import hashlib
from unittest.mock import patch

import sz_frame
from sz_frame import (
    FrameError,
    FrameStreamDecoder,
    OutboundFrameStreamDecoder,
    SATANIC_ZONE_ROUTE,
    UnaccountedOutboundBytes,
    build_computed_satanic_zone_request,
    build_frame,
    build_generic_frame,
    computed_generic_token,
    computed_request_token,
    frame_summary,
    freshen_request_token,
    parse_frame,
    parse_generic_frame,
    recover_frame_counter,
    recover_generic_frame_counter,
    request_token_analysis,
    response_signals,
    sanitized_zone_observation,
)


def request_body(account: bytes = b"1234567", crossregion: bytes = b"12345678901") -> bytes:
    return (
        b"\0\0"
        + SATANIC_ZONE_ROUTE
        + b"\0R\0unique_account_id="
        + account
        + b"&crossregion_identifier="
        + crossregion
        + b"\0"
    )


class SatanicZoneFrameTests(unittest.TestCase):
    def test_builds_and_parses_little_endian_length_frame(self) -> None:
        frame = build_frame(request_body(), b"012345abcdef")
        parsed = parse_frame(frame)

        self.assertEqual(parsed.token, b"012345abcdef")
        self.assertEqual(parsed.body, request_body())
        self.assertTrue(parsed.is_satanic_zone_request)
        self.assertEqual(len(frame), 16 + len(request_body()))

    def test_stream_decoder_handles_noise_splits_and_coalesced_frames(self) -> None:
        first = build_frame(request_body(), b"012345abcdef")
        second = build_frame(request_body(b"7654321"), b"fedcba543210")
        decoder = FrameStreamDecoder(SATANIC_ZONE_ROUTE)

        self.assertEqual(decoder.feed(b"noise" + first[:9]), [])
        self.assertEqual(decoder.feed(first[9:31]), [])
        frames = decoder.feed(first[31:] + second)

        self.assertEqual([frame.raw for frame in frames], [first, second])
        self.assertEqual(decoder.buffered_bytes, 0)
        self.assertEqual(decoder.discarded_bytes, len(b"noise"))

    def test_fresh_token_preserves_every_other_byte(self) -> None:
        original = build_frame(request_body(), b"012345abcdef")
        fresh = freshen_request_token(original, lambda: b"111111222222")

        self.assertEqual(fresh[:12], b"111111222222")
        self.assertEqual(fresh[12:], original[12:])
        self.assertNotEqual(frame_summary(fresh)["sha256"], frame_summary(original)["sha256"])

    def test_computed_token_matches_current_build_formula_and_preserves_captured_body(self) -> None:
        body = request_body()
        expected_token = hashlib.md5(body + b"\xff").hexdigest()[:12].encode("ascii")
        captured = build_frame(body, computed_request_token(body, 254))

        computed = build_computed_satanic_zone_request(captured, 255)

        self.assertEqual(parse_frame(computed).token, expected_token)
        self.assertEqual(computed[12:], captured[12:])

    def test_counter_recovery_exhaustively_tests_unsigned_byte_domain(self) -> None:
        body = request_body()
        frame = build_frame(body, computed_request_token(body, 73))

        with patch("sz_frame._computed_token", wraps=sz_frame._computed_token) as token_builder:
            recovered = recover_frame_counter(frame)

        self.assertEqual(recovered, 73)
        self.assertEqual(
            [call.args[1] for call in token_builder.call_args_list],
            list(range(256)),
        )

    def test_generic_token_and_counter_match_current_build_four_hex_framing(self) -> None:
        body = b"generic-packet-body\0"
        expected = hashlib.md5(body + b"\x9a").hexdigest()[:4].encode("ascii")
        frame = build_generic_frame(body, computed_generic_token(body, 154))

        parsed = parse_generic_frame(frame)

        self.assertEqual(parsed.token, expected)
        self.assertEqual(parsed.body, body)
        self.assertEqual(parsed.framing, "generic")
        self.assertEqual(recover_generic_frame_counter(frame), 154)

    def test_strict_outbound_decoder_fragments_and_coalesces_both_framings(self) -> None:
        api_body = request_body()
        generic_body = b"generic-packet-body\0"
        api = build_frame(api_body, computed_request_token(api_body, 9))
        generic = build_generic_frame(generic_body, computed_generic_token(generic_body, 10))
        decoder = OutboundFrameStreamDecoder()

        self.assertEqual(decoder.feed(api[:7]), [])
        self.assertEqual(decoder.buffered_bytes, 7)
        decoded = decoder.feed(api[7:] + generic)

        self.assertEqual([event.raw for event in decoded], [api, generic])
        self.assertEqual([event.framing for event in decoded], ["api", "generic"])
        self.assertEqual(decoder.buffered_bytes, 0)
        self.assertEqual(decoder.discarded_bytes, 0)

    def test_strict_outbound_decoder_surfaces_unaccounted_bytes_in_order(self) -> None:
        body = request_body()
        frame = build_frame(body, computed_request_token(body, 44))
        decoder = OutboundFrameStreamDecoder()

        decoded = decoder.feed(b"not-framed" + frame + b"!")

        self.assertIsInstance(decoded[0], UnaccountedOutboundBytes)
        self.assertEqual(decoded[1].raw, frame)
        self.assertIsInstance(decoded[2], UnaccountedOutboundBytes)
        self.assertEqual(decoder.buffered_bytes, 0)

    def test_counter_helpers_fail_closed_for_invalid_or_unmatched_values(self) -> None:
        body = request_body()
        unmatched = build_frame(body, b"012345abcdef")

        self.assertIsNone(recover_frame_counter(unmatched))
        for counter in (-1, 256, True):
            with self.subTest(counter=counter):
                with self.assertRaises(FrameError):
                    computed_request_token(body, counter)

    def test_rejects_malformed_or_non_sz_frames(self) -> None:
        with self.assertRaises(FrameError):
            parse_frame(b"too-short")
        with self.assertRaises(FrameError):
            freshen_request_token(build_frame(b"\0save\0", b"012345abcdef"))
        with self.assertRaises(FrameError):
            build_frame(request_body(), b"not-hex-token")

    def test_detects_zone_response_fields_without_retaining_values(self) -> None:
        signals = response_signals(
            b'{"satanicZoneName":"Act_01_01","buffs":"1|2","debuffs":"3"}'
        )
        self.assertEqual(signals, {"zoneName": True, "buffs": True, "debuffs": True})

    def test_extracts_only_a_bounded_sanitized_zone_observation(self) -> None:
        observed_at = "2026-08-24T05:15:42.428910Z"
        observation = sanitized_zone_observation(
            b'prefix\x00{"status":"1","unique_account_id":"12345678",'
            b'"payload":{"satanicZoneName":"Act_08_03","buffs":"21|22|5",'
            b'"debuffs":[25,18]}}trailer',
            observed_at,
        )

        self.assertEqual(
            observation,
            {
                "schemaVersion": 1,
                "rawZone": "Act_08_03",
                "buffs": [21, 22, 5],
                "debuffs": [25, 18],
                "observedAt": observed_at,
            },
        )
        self.assertNotIn("12345678", repr(observation))

    def test_rejects_malformed_zone_observations(self) -> None:
        observed_at = "2026-08-24T05:15:42.428910Z"
        self.assertIsNone(sanitized_zone_observation(b'{"satanicZoneName":"../bad","buffs":"1","debuffs":"2"}', observed_at))
        self.assertIsNone(sanitized_zone_observation(b'{"satanicZoneName":"Act_01_01","buffs":"1"}', observed_at))
        self.assertIsNone(sanitized_zone_observation(b'{"satanicZoneName":"Act_01_01","buffs":[1.5],"debuffs":"2"}', observed_at))
        self.assertIsNone(sanitized_zone_observation(b'{"satanicZoneName":"Act_01_01","buffs":[1e999],"debuffs":"2"}', observed_at))
        self.assertIsNone(sanitized_zone_observation(b'{"satanicZoneName":"Act_01_01","buffs":"1","debuffs":"2"}', "not-a-time"))

    def test_token_analysis_reports_relations_without_token_values(self) -> None:
        analysis = request_token_analysis(
            build_frame(request_body(), b"012345abcdef"),
            previous_token=b"012345abcdee",
            prior_server_payload=b"server bytes mentioning 012345abcdef earlier",
        )

        self.assertEqual(
            analysis,
            {
                "seenInPriorServerPayload": True,
                "repeatedPreviousToken": False,
                "changedHexCharactersFromPrevious": 1,
                "bitDistanceFromPrevious": 1,
                "matchingBodyDigestEdges": [],
            },
        )
        self.assertNotIn("012345abcdef", repr(analysis))

    def test_token_analysis_detects_body_digest_edge_matches(self) -> None:
        body = request_body()
        token = hashlib.sha256(body).hexdigest()[:12].encode("ascii")
        analysis = request_token_analysis(build_frame(body, token))

        self.assertEqual(analysis["matchingBodyDigestEdges"], ["sha256:prefix"])


if __name__ == "__main__":
    unittest.main()
