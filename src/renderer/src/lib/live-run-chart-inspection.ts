import type { LiveRunChartLane } from "./live-run-history";
import { formatDuration, formatNumber } from "./format";

export interface LiveRunChartInspectionValue {
  id: string;
  label: string;
  value: number;
}

export interface LiveRunChartInspection {
  elapsedMs: number;
  values: readonly LiveRunChartInspectionValue[];
}

export interface LiveRunTooltipPosition {
  left: number;
  top: number;
}

export function inspectLiveRunChartLanes(
  lanes: readonly LiveRunChartLane[],
  elapsedMs: number,
): LiveRunChartInspection {
  const inspectedElapsedMs = finiteNonNegative(elapsedMs);
  const graphStarts = lanes.flatMap((lane) => lane.points.length ? [lane.points[0]!.elapsedMs] : []);
  const graphStart = graphStarts.length ? Math.min(...graphStarts) : 0;

  return {
    elapsedMs: inspectedElapsedMs,
    values: lanes.map((lane) => ({
      id: lane.id,
      label: lane.label,
      value: liveRunLaneValueAt(lane, graphStart + inspectedElapsedMs),
    })),
  };
}

export function formatLiveRunChartInspectionSummary(
  elapsedMs: number,
  values: readonly { label: string; value: number }[],
  context = "since graph tracking began",
): string {
  return [
    `${formatDuration(elapsedMs)} ${context}`,
    ...values.map(({ label, value }) => `${label} ${formatNumber(value)}`),
  ].join(", ");
}

export function summarizeLiveRunLaneTrend(lane: LiveRunChartLane, origin = "graph tracking began"): string {
  const firstPoint = lane.points[0];
  const lastPoint = lane.points.at(-1);
  if (!firstPoint || !lastPoint) return `${lane.label} has no graph history yet.`;

  const changes = lane.points.slice(1).filter((point, index) => point.value !== lane.points[index]?.value);
  const historyDuration = formatDuration(Math.max(lastPoint.elapsedMs - firstPoint.elapsedMs, 0));
  if (!changes.length) {
    return `${lane.label} is ${formatNumber(lane.latestValue)} with no recorded change during ${historyDuration} of graph history.`;
  }

  const latestChange = changes.at(-1)!;
  const latestChangeAt = formatDuration(Math.max(latestChange.elapsedMs - firstPoint.elapsedMs, 0));
  return `${lane.label} is ${formatNumber(lane.latestValue)} after ${changes.length} recorded ${changes.length === 1 ? "change" : "changes"}; the latest was ${latestChangeAt} after ${origin}.`;
}

export function clampLiveRunTooltipPosition(
  anchorX: number,
  anchorY: number,
  tooltipWidth: number,
  tooltipHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): LiveRunTooltipPosition {
  const gap = 12;
  const margin = 8;
  const preferredLeft = anchorX + gap + tooltipWidth <= viewportWidth - margin
    ? anchorX + gap
    : anchorX - tooltipWidth - gap;
  const preferredTop = anchorY + gap + tooltipHeight <= viewportHeight - margin
    ? anchorY + gap
    : anchorY - tooltipHeight - gap;
  return {
    left: Math.min(Math.max(preferredLeft, margin), Math.max(viewportWidth - tooltipWidth - margin, margin)),
    top: Math.min(Math.max(preferredTop, margin), Math.max(viewportHeight - tooltipHeight - margin, margin)),
  };
}

function liveRunLaneValueAt(lane: LiveRunChartLane, elapsedMs: number): number {
  let value = lane.points[0]?.value ?? 0;
  for (const point of lane.points) {
    if (point.elapsedMs > elapsedMs) break;
    value = point.value;
  }
  return finiteNonNegative(value);
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}
