from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Literal

from global_shuffle import (
    MAX_GLOBAL_SHUFFLE_FLOWS,
    MAX_GLOBAL_SHUFFLE_OBSERVATIONS,
    global_shuffle_feasibility,
)


GLOBAL_REQUIRED_TRANSITIONS = 8
GLOBAL_REQUIRED_FLOW_SWITCHES = 1
FLOW_LOCAL_REQUIRED_INTERLEAVED_API_TRANSITIONS = 3
INTERLEAVING_GUARD_SECONDS = 0.500
MIN_INTERLEAVED_OTHER_FLOW_FRAMES = 1
MAX_INTERLEAVED_OTHER_FLOW_FRAMES = 32

CounterScope = Literal["global", "flow_local"]


@dataclass
class _FlowEvidence:
    last_counter: int | None = None
    last_at: float = 0.0
    last_sequence: int = 0
    last_framing: str | None = None
    continuity_transitions: int = 0
    api_continuity_transitions: int = 0
    interleaved_transition_windows: list[_ProofTransition] = field(
        default_factory=list
    )


@dataclass(frozen=True)
class _ProofTransition:
    start_sequence: int
    end_sequence: int
    start_at: float
    end_at: float


@dataclass(frozen=True)
class _StoredObservation:
    sequence: int
    flow_id: str
    candidates: tuple[int, ...]


@dataclass(frozen=True)
class ScopeEvidence:
    global_continuity_transitions: int
    global_flow_switches: int
    global_spans_multiple_flows: bool
    global_evidence_fresh: bool
    global_evidence_ready: bool
    global_contradicted_by_target_interleaving: bool
    target_flow_continuity_transitions: int
    target_api_continuity_transitions: int
    target_interleaved_api_transitions: int
    target_evidence_fresh: bool
    target_flow_local_evidence_ready: bool
    clean_epoch_active: bool
    participant_flow_continuity_ready: bool
    global_shuffle_feasible: bool
    global_shuffle_infeasible: bool
    global_shuffle_unknown: bool
    shuffle_flow_count: int
    shuffle_observation_count: int

    def persistable(self) -> dict[str, bool | int]:
        return {
            "globalContinuityTransitions": self.global_continuity_transitions,
            "globalFlowSwitches": self.global_flow_switches,
            "globalSpansMultipleFlows": self.global_spans_multiple_flows,
            "globalEvidenceFresh": self.global_evidence_fresh,
            "globalEvidenceReady": self.global_evidence_ready,
            "globalContradictedByTargetInterleaving": (
                self.global_contradicted_by_target_interleaving
            ),
            "targetFlowContinuityTransitions": self.target_flow_continuity_transitions,
            "targetApiContinuityTransitions": self.target_api_continuity_transitions,
            "targetInterleavedApiTransitions": self.target_interleaved_api_transitions,
            "targetEvidenceFresh": self.target_evidence_fresh,
            "targetFlowLocalEvidenceReady": self.target_flow_local_evidence_ready,
            "cleanEpochActive": self.clean_epoch_active,
            "participantFlowContinuityReady": (
                self.participant_flow_continuity_ready
            ),
            "globalShuffleFeasible": self.global_shuffle_feasible,
            "globalShuffleInfeasible": self.global_shuffle_infeasible,
            "globalShuffleUnknown": self.global_shuffle_unknown,
            "shuffleFlowCount": self.shuffle_flow_count,
            "shuffleObservationCount": self.shuffle_observation_count,
        }


@dataclass(frozen=True)
class ScopeSelection:
    scope: CounterScope
    current_counter: int
    evidence: ScopeEvidence


@dataclass(frozen=True)
class CounterObservation:
    verified: bool
    candidate_set_accounted: bool
    global_transition_checked: bool
    global_transition_continuous: bool
    flow_transition_checked: bool
    flow_transition_continuous: bool
    interleaving_frames_within_bounds: bool
    clean_epoch_active: bool


class CounterScopeTracker:
    """In-memory, fail-closed discriminator for effective API counter scope.

    A caller may start qualification only at a clean boundary where every live
    tracked client stream has been idle for at least
    ``INTERLEAVING_GUARD_SECONDS`` and every decoder buffer is empty. The
    tracker then retains the complete, non-evicted candidate-set epoch. A new
    counter-bearing topology member, unaccounted observation, discontinuous
    participant sequence, or fixed-cap overflow taints that epoch.

    Counter values never appear in ``ScopeEvidence``. They remain in memory and
    are exposed only through ``ScopeSelection`` for immediate frame building.
    Cross-socket callback order is not a defensible total wire order, so global
    evidence is diagnostic and can never authorize dispatch.
    """

    def __init__(self) -> None:
        self._flows: dict[str, _FlowEvidence] = {}
        self._known_flow_ids: set[str] = set()
        self._next_sequence = 0

        self._epoch_start_sequence: int | None = None
        self._epoch_expected_flow_ids: set[str] = set()
        self._epoch_observations: list[_StoredObservation] = []
        self._verified_epoch_observations: list[tuple[str, float]] = []

        self._global_last_counter: int | None = None
        self._global_last_at = 0.0
        self._global_last_flow_id: str | None = None
        self._global_continuity_transitions = 0
        self._global_epoch_flow_ids: set[str] = set()
        self._global_flow_switches = 0

    @property
    def epoch_active(self) -> bool:
        return self._epoch_start_sequence is not None

    @property
    def known_counter_flow_count(self) -> int:
        return len(self._known_flow_ids)

    def start_clean_epoch(self) -> bool:
        """Start one complete proof epoch after caller-verified quiescence."""

        if self.epoch_active:
            return False
        if not self._known_flow_ids:
            return False
        if len(self._known_flow_ids) > MAX_GLOBAL_SHUFFLE_FLOWS:
            return False

        self._epoch_start_sequence = self._next_sequence + 1
        self._epoch_expected_flow_ids = set(self._known_flow_ids)
        self._epoch_observations.clear()
        self._verified_epoch_observations.clear()
        self._reset_epoch_flow_metrics()
        self._reset_global_epoch()
        return True

    def taint_model(self) -> None:
        """Discard the active proof epoch without discarding exact live state."""

        self._taint_epoch()

    def observe(
        self,
        flow_id: str,
        framing: str,
        matching_counters: Iterable[int],
        observed_at: float,
    ) -> CounterObservation:
        self._next_sequence += 1
        sequence = self._next_sequence

        is_new_counter_flow = flow_id not in self._known_flow_ids
        if is_new_counter_flow:
            self._known_flow_ids.add(flow_id)
            if self.epoch_active:
                # The current observation is outside the now-tainted epoch. A
                # later clean boundary must include this topology member.
                self._taint_epoch()

        distinct_matches = _normalized_candidates(matching_counters)
        if not distinct_matches:
            self.invalidate(flow_id, taint_sequence=sequence)
            return CounterObservation(
                False,
                False,
                False,
                False,
                False,
                False,
                False,
                self.epoch_active,
            )

        epoch_recorded = self._append_epoch_observation(
            _StoredObservation(sequence, flow_id, distinct_matches)
        )
        if len(distinct_matches) != 1:
            # Candidate collisions stay as branches in the complete epoch, but
            # cannot supply an exact current value or a guarded proof anchor.
            self._flows.pop(flow_id, None)
            self._reset_global_epoch()
            return CounterObservation(
                False,
                True,
                False,
                False,
                False,
                False,
                False,
                epoch_recorded and self.epoch_active,
            )

        counter = distinct_matches[0]
        flow = self._flows.setdefault(flow_id, _FlowEvidence())
        previous_flow_counter = flow.last_counter
        previous_flow_at = flow.last_at
        previous_flow_sequence = flow.last_sequence
        previous_framing = flow.last_framing
        flow_transition_checked = previous_flow_counter is not None
        flow_transition_continuous = flow_transition_checked and counter == (
            previous_flow_counter + 1
        ) % 256

        epoch_start = self._epoch_start_sequence
        previous_is_epoch_anchor = (
            epoch_recorded
            and epoch_start is not None
            and previous_flow_sequence >= epoch_start
        )
        interleaving_frames_within_bounds = False
        if previous_is_epoch_anchor and flow_transition_continuous:
            flow.continuity_transitions += 1
            if previous_framing == "api" and framing == "api":
                flow.api_continuity_transitions += 1
                guarded_other_flow_frames = sum(
                    1
                    for other_flow_id, other_at in self._verified_epoch_observations
                    if other_flow_id != flow_id
                    and other_at - previous_flow_at >= INTERLEAVING_GUARD_SECONDS
                    and observed_at - other_at >= INTERLEAVING_GUARD_SECONDS
                )
                interleaving_frames_within_bounds = (
                    MIN_INTERLEAVED_OTHER_FLOW_FRAMES
                    <= guarded_other_flow_frames
                    <= MAX_INTERLEAVED_OTHER_FLOW_FRAMES
                )
                if interleaving_frames_within_bounds:
                    flow.interleaved_transition_windows.append(
                        _ProofTransition(
                            previous_flow_sequence,
                            sequence,
                            previous_flow_at,
                            observed_at,
                        )
                    )
        elif epoch_recorded:
            flow.continuity_transitions = 0
            flow.api_continuity_transitions = 0
            flow.interleaved_transition_windows.clear()

        global_transition_checked = (
            epoch_recorded and self._global_last_counter is not None
        )
        global_transition_continuous = global_transition_checked and counter == (
            self._global_last_counter + 1
        ) % 256
        if epoch_recorded:
            if global_transition_continuous:
                self._global_continuity_transitions += 1
                self._global_epoch_flow_ids.add(flow_id)
                if self._global_last_flow_id != flow_id:
                    self._global_flow_switches += 1
            else:
                self._global_continuity_transitions = 0
                self._global_epoch_flow_ids = {flow_id}
                self._global_flow_switches = 0
            self._global_last_counter = counter
            self._global_last_at = observed_at
            self._global_last_flow_id = flow_id
            self._verified_epoch_observations.append((flow_id, observed_at))

        flow.last_counter = counter
        flow.last_at = observed_at
        flow.last_sequence = sequence
        flow.last_framing = framing
        return CounterObservation(
            True,
            True,
            global_transition_checked,
            global_transition_continuous,
            flow_transition_checked,
            flow_transition_continuous,
            interleaving_frames_within_bounds,
            epoch_recorded and self.epoch_active,
        )

    def invalidate(self, flow_id: str, *, taint_sequence: int | None = None) -> None:
        if taint_sequence is None:
            self._next_sequence += 1
        self._taint_epoch()
        self._flows.pop(flow_id, None)

    def forget_flow(self, flow_id: str) -> None:
        if flow_id in self._known_flow_ids and self.epoch_active:
            self._taint_epoch()
        self._flows.pop(flow_id, None)
        self._known_flow_ids.discard(flow_id)

    def evidence(
        self,
        target_flow_id: str,
        now: float,
        max_age_seconds: float,
    ) -> ScopeEvidence:
        target = self._flows.get(target_flow_id)
        epoch_start = self._epoch_start_sequence
        global_fresh = (
            epoch_start is not None
            and self._global_last_counter is not None
            and 0.0 <= now - self._global_last_at <= max_age_seconds
        )
        target_fresh = (
            epoch_start is not None
            and target is not None
            and target.last_counter is not None
            and target.last_framing == "api"
            and target.last_sequence >= epoch_start
            and 0.0 <= now - target.last_at <= max_age_seconds
        )
        oldest_allowed = now - max_age_seconds
        target_interleaved = (
            sum(
                1
                for transition in target.interleaved_transition_windows
                if transition.start_sequence >= epoch_start
                and transition.start_at >= oldest_allowed
                and transition.end_at <= now
            )
            if target is not None and epoch_start is not None
            else 0
        )

        per_flow_sequences = self._epoch_per_flow_sequences()
        participant_continuity_ready = bool(per_flow_sequences) and all(
            _candidate_sequence_is_continuous(sequence)
            for sequence in per_flow_sequences.values()
        )
        if epoch_start is None:
            shuffle_status = "unknown"
        elif not participant_continuity_ready:
            shuffle_status = "unknown"
        else:
            shuffle_status = global_shuffle_feasibility(per_flow_sequences)

        global_contradicted = target_interleaved > 0
        global_ready = (
            global_fresh
            and self._global_continuity_transitions >= GLOBAL_REQUIRED_TRANSITIONS
            and len(self._global_epoch_flow_ids) >= 2
            and self._global_flow_switches >= GLOBAL_REQUIRED_FLOW_SWITCHES
            and not global_contradicted
        )
        local_ready = (
            target_fresh
            and target_interleaved
            >= FLOW_LOCAL_REQUIRED_INTERLEAVED_API_TRANSITIONS
            and participant_continuity_ready
            and shuffle_status == "infeasible"
        )
        return ScopeEvidence(
            global_continuity_transitions=self._global_continuity_transitions,
            global_flow_switches=self._global_flow_switches,
            global_spans_multiple_flows=len(self._global_epoch_flow_ids) >= 2,
            global_evidence_fresh=global_fresh,
            global_evidence_ready=global_ready,
            global_contradicted_by_target_interleaving=global_contradicted,
            target_flow_continuity_transitions=(
                target.continuity_transitions if target else 0
            ),
            target_api_continuity_transitions=(
                target.api_continuity_transitions if target else 0
            ),
            target_interleaved_api_transitions=target_interleaved,
            target_evidence_fresh=target_fresh,
            target_flow_local_evidence_ready=local_ready,
            clean_epoch_active=epoch_start is not None,
            participant_flow_continuity_ready=participant_continuity_ready,
            global_shuffle_feasible=shuffle_status == "feasible",
            global_shuffle_infeasible=shuffle_status == "infeasible",
            global_shuffle_unknown=shuffle_status == "unknown",
            shuffle_flow_count=len(per_flow_sequences),
            shuffle_observation_count=sum(
                len(sequence) for sequence in per_flow_sequences.values()
            ),
        )

    def select(
        self,
        target_flow_id: str,
        now: float,
        max_age_seconds: float,
    ) -> ScopeSelection | None:
        evidence = self.evidence(target_flow_id, now, max_age_seconds)
        target = self._flows.get(target_flow_id)
        if evidence.target_flow_local_evidence_ready:
            assert target is not None and target.last_counter is not None
            return ScopeSelection("flow_local", target.last_counter, evidence)
        if (
            evidence.clean_epoch_active
            and evidence.global_shuffle_unknown
            and evidence.shuffle_observation_count > 0
        ):
            # Unknown from bounded shuffle analysis is not a reusable suffix.
            # Force a later clean boundary and a wholly new proof epoch.
            self._taint_epoch()
        return None

    def _append_epoch_observation(self, observation: _StoredObservation) -> bool:
        if not self.epoch_active:
            return False
        if observation.flow_id not in self._epoch_expected_flow_ids:
            self._taint_epoch()
            return False

        self._epoch_observations.append(observation)
        if len(self._epoch_observations) > MAX_GLOBAL_SHUFFLE_OBSERVATIONS:
            self._taint_epoch()
            return False
        participant_ids = {stored.flow_id for stored in self._epoch_observations}
        if len(participant_ids) > MAX_GLOBAL_SHUFFLE_FLOWS:
            self._taint_epoch()
            return False

        same_flow_sequence = [
            stored.candidates
            for stored in self._epoch_observations
            if stored.flow_id == observation.flow_id
        ]
        if not _candidate_sequence_is_continuous(same_flow_sequence):
            self._taint_epoch()
            return False
        return True

    def _epoch_per_flow_sequences(self) -> dict[str, list[tuple[int, ...]]]:
        if not self.epoch_active:
            return {}
        grouped: dict[str, list[tuple[int, ...]]] = {}
        for observation in self._epoch_observations:
            grouped.setdefault(observation.flow_id, []).append(
                observation.candidates
            )
        return grouped

    def _taint_epoch(self) -> None:
        self._epoch_start_sequence = None
        self._epoch_expected_flow_ids.clear()
        self._epoch_observations.clear()
        self._verified_epoch_observations.clear()
        self._reset_epoch_flow_metrics()
        self._reset_global_epoch()

    def _reset_epoch_flow_metrics(self) -> None:
        for flow in self._flows.values():
            flow.continuity_transitions = 0
            flow.api_continuity_transitions = 0
            flow.interleaved_transition_windows.clear()

    def _reset_global_epoch(self) -> None:
        self._global_last_counter = None
        self._global_last_at = 0.0
        self._global_last_flow_id = None
        self._global_continuity_transitions = 0
        self._global_epoch_flow_ids.clear()
        self._global_flow_switches = 0


def _normalized_candidates(raw_candidates: Iterable[int]) -> tuple[int, ...]:
    try:
        distinct: set[int] = set()
        raw_count = 0
        for candidate in raw_candidates:
            raw_count += 1
            if raw_count > 256:
                return ()
            if (
                isinstance(candidate, bool)
                or not isinstance(candidate, int)
                or not 0 <= candidate <= 255
            ):
                return ()
            distinct.add(candidate)
    except TypeError:
        return ()
    return tuple(sorted(distinct))


def _candidate_sequence_is_continuous(
    sequence: Iterable[Iterable[int]],
) -> bool:
    iterator = iter(sequence)
    try:
        possible = set(next(iterator))
    except StopIteration:
        return False
    if not possible:
        return False
    for candidates in iterator:
        current = set(candidates)
        possible = {
            candidate
            for candidate in current
            if (candidate - 1) % 256 in possible
        }
        if not possible:
            return False
    return True
