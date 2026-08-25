from __future__ import annotations

from pathlib import Path
import sys

RELAY_DIR = Path(__file__).resolve().parents[2] / "resources" / "satanic-zone-relay"
sys.path.insert(0, str(RELAY_DIR))

import unittest
from unittest.mock import patch

import global_shuffle
from global_shuffle import (
    MAX_GLOBAL_SHUFFLE_FLOWS,
    MAX_GLOBAL_SHUFFLE_OBSERVATIONS,
    global_shuffle_feasibility,
)


class GlobalShuffleFeasibilityTests(unittest.TestCase):
    def test_delayed_callback_adversary_remains_globally_feasible(self) -> None:
        # Callback order could be T10, O7, T11, O8, T12, O9, T13. Per-flow
        # order still admits the global wire order O7, O8, O9, T10..T13.
        feasibility = global_shuffle_feasibility(
            {
                "target": [{10}, {11}, {12}, {13}],
                "other": [{7}, {8}, {9}],
            }
        )

        self.assertEqual(feasibility, "feasible")

    def test_independent_counter_ranges_make_global_shuffle_infeasible(self) -> None:
        feasibility = global_shuffle_feasibility(
            {
                "target": [{20}, {21}, {22}, {23}],
                "other": [{100}, {101}, {102}],
            }
        )

        self.assertEqual(feasibility, "infeasible")

    def test_candidate_collision_branches_are_searched(self) -> None:
        feasibility = global_shuffle_feasibility(
            {
                "target": [{10}, {11}],
                "other": [{9, 12}, {13}],
            }
        )

        self.assertEqual(feasibility, "feasible")

    def test_modulo_256_wrap_is_supported(self) -> None:
        feasibility = global_shuffle_feasibility(
            {
                "before-wrap": [{254}, {255}],
                "after-wrap": [{0}, {1}],
            }
        )

        self.assertEqual(feasibility, "feasible")

    def test_empty_candidate_set_is_tainted_and_returns_unknown(self) -> None:
        self.assertEqual(
            global_shuffle_feasibility({"target": [{1}, set()]}),
            "unknown",
        )

    def test_empty_observation_set_is_vacuously_feasible(self) -> None:
        self.assertEqual(global_shuffle_feasibility({}), "feasible")

    def test_flow_cap_overflow_returns_unknown(self) -> None:
        sequences = {
            f"flow-{index}": [{index}]
            for index in range(MAX_GLOBAL_SHUFFLE_FLOWS + 1)
        }

        self.assertEqual(global_shuffle_feasibility(sequences), "unknown")

    def test_observation_cap_overflow_returns_unknown(self) -> None:
        self.assertEqual(MAX_GLOBAL_SHUFFLE_OBSERVATIONS, 64)
        sequences = {
            "target": [
                {index % 256}
                for index in range(MAX_GLOBAL_SHUFFLE_OBSERVATIONS + 1)
            ]
        }

        self.assertEqual(global_shuffle_feasibility(sequences), "unknown")

    def test_state_cap_overflow_returns_unknown(self) -> None:
        with patch.object(global_shuffle, "MAX_GLOBAL_SHUFFLE_STATES", 1):
            feasibility = global_shuffle_feasibility(
                {
                    "target": [{10}, {11}],
                    "other": [{20}, {21}],
                }
            )

        self.assertEqual(feasibility, "unknown")

    def test_malformed_candidate_returns_unknown(self) -> None:
        self.assertEqual(
            global_shuffle_feasibility({"target": [{True}]}),
            "unknown",
        )


if __name__ == "__main__":
    unittest.main()
