export const COMPANION_VIEWS = [
  { id: "live", label: "Live Session" },
  { id: "filter", label: "Item Filter" },
  { id: "market", label: "Market" },
  { id: "past", label: "Past Runs" },
] as const;
export type CompanionView = (typeof COMPANION_VIEWS)[number]["id"];

export function nextCompanionView(current: CompanionView, key: string): CompanionView | null {
  const index = COMPANION_VIEWS.findIndex((view) => view.id === current);
  if (key === "Home") return COMPANION_VIEWS[0].id;
  if (key === "End") return COMPANION_VIEWS[COMPANION_VIEWS.length - 1].id;
  const direction = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  return direction ? COMPANION_VIEWS[(index + direction + COMPANION_VIEWS.length) % COMPANION_VIEWS.length].id : null;
}
