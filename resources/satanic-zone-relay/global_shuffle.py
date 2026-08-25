from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Literal


MAX_GLOBAL_SHUFFLE_FLOWS = 8
MAX_GLOBAL_SHUFFLE_OBSERVATIONS = 64
MAX_GLOBAL_SHUFFLE_STATES = 50_000
MAX_COUNTER_CANDIDATES = 256

GlobalShuffleFeasibility = Literal["feasible", "infeasible", "unknown"]


def global_shuffle_feasibility(
    per_flow_sequences: Mapping[str, Sequence[Iterable[int]]],
) -> GlobalShuffleFeasibility:
    """Assess whether observed counters admit one process-global sequence.

    TCP preserves ordering within a flow, but callbacks from different flows do
    not establish a total wire order. This search therefore considers every
    merge that preserves each flow's local order. Each observation retains its
    complete set of candidate counters, and a merge is feasible only when one
    candidate per observation forms an exact modulo-256 ``+1`` sequence.

    The caller must supply a complete, clean evidence epoch. A suffix produced
    by evicting older observations, or an epoch containing unaccounted bytes,
    cannot soundly prove the global hypothesis infeasible because omitted
    frames could fill an apparent counter gap.

    The search is deliberately bounded. Malformed input or any exceeded flow,
    observation, candidate, or state limit returns ``"unknown"`` so callers
    can fail closed rather than treating incomplete analysis as evidence
    against the global-counter hypothesis.
    """

    normalized = _normalize_sequences(per_flow_sequences)
    if normalized is None:
        return "unknown"

    sequences, observation_count = normalized
    if observation_count == 0:
        return "feasible"
    if any(not candidates for sequence in sequences for candidates in sequence):
        return "unknown"

    lengths = tuple(len(sequence) for sequence in sequences)
    initial_positions = tuple(0 for _ in sequences)
    initial_state: tuple[tuple[int, ...], int | None] = (
        initial_positions,
        None,
    )
    stack = [initial_state]
    seen = {initial_state}

    while stack:
        positions, last_counter = stack.pop()
        if positions == lengths:
            return "feasible"

        required_counter = (
            None if last_counter is None else (last_counter + 1) % 256
        )
        for flow_index, sequence in enumerate(sequences):
            observation_index = positions[flow_index]
            if observation_index >= lengths[flow_index]:
                continue

            candidates = sequence[observation_index]
            if required_counter is None:
                allowed_counters: Iterable[int] = candidates
            elif required_counter in candidates:
                allowed_counters = (required_counter,)
            else:
                continue

            next_positions_list = list(positions)
            next_positions_list[flow_index] += 1
            next_positions = tuple(next_positions_list)
            for counter in allowed_counters:
                if next_positions == lengths:
                    return "feasible"
                next_state = (next_positions, counter)
                if next_state in seen:
                    continue
                if len(seen) >= MAX_GLOBAL_SHUFFLE_STATES:
                    return "unknown"
                seen.add(next_state)
                stack.append(next_state)

    return "infeasible"


def _normalize_sequences(
    per_flow_sequences: Mapping[str, Sequence[Iterable[int]]],
) -> tuple[tuple[tuple[frozenset[int], ...], ...], int] | None:
    try:
        if len(per_flow_sequences) > MAX_GLOBAL_SHUFFLE_FLOWS:
            return None

        ordered_flow_ids = sorted(per_flow_sequences)
        if any(not isinstance(flow_id, str) for flow_id in ordered_flow_ids):
            return None

        observation_count = sum(
            len(per_flow_sequences[flow_id]) for flow_id in ordered_flow_ids
        )
        if observation_count > MAX_GLOBAL_SHUFFLE_OBSERVATIONS:
            return None

        normalized_sequences: list[tuple[frozenset[int], ...]] = []
        for flow_id in ordered_flow_ids:
            normalized_observations: list[frozenset[int]] = []
            for raw_candidates in per_flow_sequences[flow_id]:
                candidates: set[int] = set()
                raw_candidate_count = 0
                for candidate in raw_candidates:
                    raw_candidate_count += 1
                    if raw_candidate_count > MAX_COUNTER_CANDIDATES:
                        return None
                    if (
                        isinstance(candidate, bool)
                        or not isinstance(candidate, int)
                        or not 0 <= candidate <= 255
                    ):
                        return None
                    candidates.add(candidate)
                normalized_observations.append(frozenset(candidates))
            normalized_sequences.append(tuple(normalized_observations))
    except (KeyError, TypeError, ValueError, OverflowError):
        return None

    return tuple(normalized_sequences), observation_count
