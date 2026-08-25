from __future__ import annotations

from pathlib import Path
import sys

RELAY_DIR = Path(__file__).resolve().parents[2] / "resources" / "satanic-zone-relay"
sys.path.insert(0, str(RELAY_DIR))

import unittest

from counter_scope import (
    FLOW_LOCAL_REQUIRED_INTERLEAVED_API_TRANSITIONS,
    GLOBAL_REQUIRED_FLOW_SWITCHES,
    GLOBAL_REQUIRED_TRANSITIONS,
    INTERLEAVING_GUARD_SECONDS,
    MAX_INTERLEAVED_OTHER_FLOW_FRAMES,
    MIN_INTERLEAVED_OTHER_FLOW_FRAMES,
    CounterScopeTracker,
)


class CounterScopeTrackerTests(unittest.TestCase):
    def test_fail_closed_thresholds_are_explicit(self) -> None:
        self.assertEqual(GLOBAL_REQUIRED_TRANSITIONS, 8)
        self.assertEqual(GLOBAL_REQUIRED_FLOW_SWITCHES, 1)
        self.assertEqual(FLOW_LOCAL_REQUIRED_INTERLEAVED_API_TRANSITIONS, 3)
        self.assertEqual(INTERLEAVING_GUARD_SECONDS, 0.500)
        self.assertEqual(MIN_INTERLEAVED_OTHER_FLOW_FRAMES, 1)
        self.assertEqual(MAX_INTERLEAVED_OTHER_FLOW_FRAMES, 32)

    def test_observations_without_a_clean_boundary_never_authorize(self) -> None:
        tracker = CounterScopeTracker()
        tracker.observe("target", "api", [20], 100.0)
        for step in range(1, 4):
            tracker.observe("other", "generic", [100 + step], 101.5 + 3 * (step - 1))
            tracker.observe("target", "api", [20 + step], 100.0 + 3 * step)

        self.assertIsNone(tracker.select("target", 109.1, 30.0))
        self.assertFalse(tracker.evidence("target", 109.1, 30.0).clean_epoch_active)

    def test_global_callback_continuity_is_recorded_but_never_authorizes_selection(self) -> None:
        tracker = CounterScopeTracker()
        tracker.observe("api-flow", "api", [9], 90.0)
        tracker.observe("generic-flow", "generic", [14], 90.0)
        self.assertTrue(tracker.start_clean_epoch())
        for index, counter in enumerate(range(10, 15)):
            tracker.observe("api-flow", "api", [counter], 100.0 + index)
        for index, counter in enumerate(range(15, 19), start=5):
            tracker.observe("generic-flow", "generic", [counter], 100.0 + index)

        selection = tracker.select("api-flow", 109.0, 30.0)

        self.assertIsNone(selection)
        evidence = tracker.evidence("api-flow", 109.0, 30.0)
        self.assertEqual(evidence.global_continuity_transitions, 8)
        self.assertTrue(evidence.global_spans_multiple_flows)
        self.assertTrue(evidence.global_evidence_ready)
        self.assertTrue(evidence.global_shuffle_feasible)
        self.assertFalse(evidence.global_contradicted_by_target_interleaving)

    def test_live_style_cadence_selects_flow_local_after_three_guarded_proofs(self) -> None:
        tracker = CounterScopeTracker()
        now = self._qualify_local(tracker)

        selection = tracker.select("target", now, 30.0)

        self.assertIsNotNone(selection)
        assert selection is not None
        self.assertEqual(selection.scope, "flow_local")
        self.assertEqual(selection.current_counter, 23)
        self.assertEqual(selection.evidence.target_api_continuity_transitions, 3)
        self.assertEqual(selection.evidence.target_interleaved_api_transitions, 3)
        self.assertTrue(selection.evidence.participant_flow_continuity_ready)
        self.assertTrue(selection.evidence.global_shuffle_infeasible)

    def test_callback_interleaving_that_admits_a_global_shuffle_remains_ambiguous(self) -> None:
        tracker = CounterScopeTracker()
        tracker.observe("target", "api", [255], 90.0)
        tracker.observe("other", "generic", [3], 90.0)
        self.assertTrue(tracker.start_clean_epoch())
        tracker.observe("target", "api", [0], 100.0)
        for step in range(1, 4):
            tracker.observe("other", "generic", [3 + step], 101.5 + 3 * (step - 1))
            tracker.observe("target", "api", [step], 100.0 + 3 * step)

        evidence = tracker.evidence("target", 109.1, 30.0)

        self.assertEqual(evidence.target_interleaved_api_transitions, 3)
        self.assertTrue(evidence.global_shuffle_feasible)
        self.assertFalse(evidence.target_flow_local_evidence_ready)
        self.assertIsNone(tracker.select("target", 109.1, 30.0))

    def test_candidate_collision_branches_can_preserve_per_flow_continuity(self) -> None:
        tracker = CounterScopeTracker()
        tracker.observe("target", "api", [19], 90.0)
        tracker.observe("guard", "generic", [50], 90.0)
        tracker.observe("collision", "generic", [100, 200], 90.0)
        self.assertTrue(tracker.start_clean_epoch())
        tracker.observe("target", "api", [20], 100.0)
        for step in range(1, 4):
            collision = tracker.observe(
                "collision",
                "generic",
                [100 + step, 200 + step],
                100.75 + 3 * (step - 1),
            )
            self.assertFalse(collision.verified)
            self.assertTrue(collision.candidate_set_accounted)
            tracker.observe("guard", "generic", [50 + step], 101.5 + 3 * (step - 1))
            tracker.observe("target", "api", [20 + step], 100.0 + 3 * step)

        selection = tracker.select("target", 109.1, 30.0)

        self.assertIsNotNone(selection)
        assert selection is not None
        self.assertTrue(selection.evidence.participant_flow_continuity_ready)
        self.assertTrue(selection.evidence.global_shuffle_infeasible)

    def test_discontinuous_other_flow_taints_epoch_and_blocks_local_selection(self) -> None:
        tracker = CounterScopeTracker()
        tracker.observe("target", "api", [19], 90.0)
        tracker.observe("other", "generic", [100], 90.0)
        self.assertTrue(tracker.start_clean_epoch())
        tracker.observe("target", "api", [20], 100.0)
        tracker.observe("other", "generic", [101], 101.5)
        tracker.observe("target", "api", [21], 103.0)
        discontinuity = tracker.observe("other", "generic", [150], 104.5)

        self.assertTrue(discontinuity.verified)
        self.assertFalse(discontinuity.flow_transition_continuous)
        self.assertFalse(tracker.epoch_active)
        self.assertIsNone(tracker.select("target", 104.6, 30.0))

    def test_malformed_candidate_set_taints_instead_of_narrowing_to_valid_subset(self) -> None:
        tracker = CounterScopeTracker()
        tracker.observe("target", "api", [19], 90.0)
        self.assertTrue(tracker.start_clean_epoch())

        observation = tracker.observe("target", "api", [20, 999], 100.0)

        self.assertFalse(observation.verified)
        self.assertFalse(observation.candidate_set_accounted)
        self.assertFalse(tracker.epoch_active)

    def test_target_reset_and_new_flow_require_a_wholly_new_epoch(self) -> None:
        tracker = CounterScopeTracker()
        now = self._qualify_local(tracker, target_start=30)
        self.assertIsNotNone(tracker.select("target", now, 30.0))

        tracker.observe("new-topology", "generic", [200], now + 0.5)
        self.assertFalse(tracker.epoch_active)
        self.assertIsNone(tracker.select("target", now + 0.6, 30.0))

        self.assertTrue(tracker.start_clean_epoch())
        tracker.observe("target", "api", [34], now + 1.0)
        for step in range(1, 4):
            tracker.observe(
                "new-topology",
                "generic",
                [200 + step],
                now + 2.5 + 3 * (step - 1),
            )
            tracker.observe(
                "target",
                "api",
                [34 + step],
                now + 1.0 + 3 * step,
            )
        self.assertIsNotNone(tracker.select("target", now + 10.1, 30.0))

        tracker.observe("target", "api", [99], now + 11.0)
        self.assertFalse(tracker.epoch_active)
        self.assertIsNone(tracker.select("target", now + 11.1, 30.0))

    def test_old_proof_windows_cannot_be_refreshed_by_one_direct_target_frame(self) -> None:
        tracker = CounterScopeTracker()
        now = self._qualify_local(tracker, target_start=70)
        self.assertIsNotNone(tracker.select("target", now, 15.0))

        tracker.observe("target", "api", [74], 200.0)

        self.assertIsNone(tracker.select("target", 200.1, 15.0))
        evidence = tracker.evidence("target", 200.1, 15.0)
        self.assertEqual(evidence.target_interleaved_api_transitions, 0)
        self.assertTrue(evidence.target_evidence_fresh)

    def test_guard_ignores_near_callback_frames_and_caps_busy_intervals(self) -> None:
        tracker = CounterScopeTracker()
        tracker.observe("target", "api", [0], 90.0)
        tracker.observe("other", "generic", [49], 90.0)
        self.assertTrue(tracker.start_clean_epoch())
        tracker.observe("target", "api", [1], 100.0)
        tracker.observe("other", "generic", [50], 100.49)
        tracker.observe("other", "generic", [51], 102.51)
        first = tracker.observe("target", "api", [2], 103.0)
        self.assertFalse(first.interleaving_frames_within_bounds)

        tracker.observe("other", "generic", [52], 104.0)
        second = tracker.observe("target", "api", [3], 106.0)
        self.assertTrue(second.interleaving_frames_within_bounds)

        for index in range(MAX_INTERLEAVED_OTHER_FLOW_FRAMES + 1):
            tracker.observe("other", "generic", [53 + index], 107.0 + index * 0.01)
        third = tracker.observe("target", "api", [4], 109.0)
        self.assertFalse(third.interleaving_frames_within_bounds)
        evidence = tracker.evidence("target", 109.1, 30.0)
        self.assertEqual(evidence.target_interleaved_api_transitions, 1)

    def test_persistable_evidence_never_exposes_raw_values(self) -> None:
        tracker = CounterScopeTracker()
        self._qualify_local(tracker, target_start=40)

        evidence = tracker.evidence("target", 109.1, 30.0).persistable()

        self.assertNotIn("currentCounter", evidence)
        self.assertFalse(any(key.lower() == "counter" for key in evidence))

    @staticmethod
    def _qualify_local(
        tracker: CounterScopeTracker,
        *,
        target_start: int = 20,
        start_at: float = 100.0,
    ) -> float:
        tracker.observe("target", "api", [(target_start - 1) % 256], start_at - 10.0)
        tracker.observe("other", "generic", [100], start_at - 10.0)
        if not tracker.start_clean_epoch():
            raise AssertionError("clean epoch did not start")
        tracker.observe("target", "api", [target_start], start_at)
        for step in range(1, 4):
            tracker.observe(
                "other",
                "generic",
                [100 + step],
                start_at + 1.5 + 3 * (step - 1),
            )
            tracker.observe(
                "target",
                "api",
                [(target_start + step) % 256],
                start_at + 3 * step,
            )
        return start_at + 9.1


if __name__ == "__main__":
    unittest.main()
