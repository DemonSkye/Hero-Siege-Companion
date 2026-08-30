import type { LiveRunChartLane } from "./live-run-history";

export const LIVE_RUN_CHART_FALLBACK_WIDTH = 1_000;
export const LIVE_RUN_CHART_FALLBACK_HEIGHT = 160;

export function liveRunChartStepPath(lane: LiveRunChartLane, width: number): string {
  const points = lane.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!points.length) return "";
  const commands = [`M ${coordinate(points[0]!.x)} ${coordinate(points[0]!.y)}`];
  for (const point of points.slice(1)) commands.push(`H ${coordinate(point.x)} V ${coordinate(point.y)}`);
  if (points.length === 1 && points[0]!.x < width) commands.push(`H ${coordinate(width)}`);
  return commands.join(" ");
}

export function liveRunChartWidth(lane: LiveRunChartLane): number {
  return positiveCoordinate(lane.chartWidth) || LIVE_RUN_CHART_FALLBACK_WIDTH;
}

export function liveRunChartHeight(lane: LiveRunChartLane): number {
  return positiveCoordinate(lane.chartHeight) || LIVE_RUN_CHART_FALLBACK_HEIGHT;
}

export function emptyLiveRunChartLane(
  metric: LiveRunChartLane["metric"],
  label: string,
  id: string = metric,
  itemName: string | null = null,
): LiveRunChartLane {
  return {
    id,
    metric,
    label,
    itemName,
    chartWidth: LIVE_RUN_CHART_FALLBACK_WIDTH,
    chartHeight: LIVE_RUN_CHART_FALLBACK_HEIGHT,
    latestValue: 0,
    maxValue: 0,
    points: [],
    svgPoints: "",
  };
}

function positiveCoordinate(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

function finiteCoordinate(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

function coordinate(value: number): string {
  return String(Math.round(finiteCoordinate(value) * 1_000) / 1_000);
}
