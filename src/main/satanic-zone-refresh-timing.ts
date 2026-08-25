export interface ManualTimeoutSuppression {
  refreshId: number;
  settledAt: number;
  requestCutoffAt: number;
  expiresAt: number;
}

export function latestFiniteTimestamp(...values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length > 0 ? Math.max(...finite) : null;
}

export function extendRefreshDeadline(
  current: number | null,
  cooldownMs: number,
  ...anchors: Array<number | null | undefined>
): number | null {
  const anchor = latestFiniteTimestamp(...anchors);
  if (anchor === null || !Number.isFinite(cooldownMs)) return current;
  const candidate = anchor + cooldownMs;
  if (!Number.isFinite(candidate)) return current;
  return current === null || !Number.isFinite(current) ? candidate : Math.max(current, candidate);
}

export function createManualTimeoutSuppression(
  refreshId: number,
  settledAt: number,
  suppressionMs: number,
  requestLagMs = 0,
): ManualTimeoutSuppression | null {
  if (
    !Number.isSafeInteger(refreshId)
    || refreshId <= 0
    || !Number.isFinite(settledAt)
    || !Number.isFinite(requestLagMs)
    || requestLagMs < 0
  ) return null;
  const requestCutoffAt = settledAt + requestLagMs;
  const expiresAt = settledAt + suppressionMs;
  return Number.isFinite(requestCutoffAt) && Number.isFinite(expiresAt)
    ? { refreshId, settledAt, requestCutoffAt, expiresAt }
    : null;
}

export function suppressesPassiveRequest(
  suppression: ManualTimeoutSuppression | null,
  observedAt: number,
): boolean {
  if (!suppression || !Number.isFinite(observedAt)) return false;
  return observedAt >= suppression.settledAt && observedAt <= suppression.requestCutoffAt;
}

export function suppressesPassiveTimeout(
  suppression: ManualTimeoutSuppression | null,
  observedAt: number,
  requestedAt: number | undefined,
): boolean {
  if (!suppression || !Number.isFinite(observedAt) || !Number.isFinite(requestedAt)) return false;
  return (requestedAt as number) <= suppression.requestCutoffAt
    && observedAt >= (requestedAt as number)
    && observedAt <= suppression.expiresAt;
}
