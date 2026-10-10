export interface TooltipPlacement {
  left: number;
  top: number;
  side: "above" | "below";
}

interface Rect { left: number; top: number; width: number; height: number }
interface Size { width: number; height: number }

const GAP = 8;
const MARGIN = 8;

export function placeTooltip(anchor: Rect, tip: Size, viewport: Size): TooltipPlacement {
  const spaceAbove = anchor.top - GAP - MARGIN;
  const spaceBelow = viewport.height - (anchor.top + anchor.height) - GAP - MARGIN;
  const side = tip.height <= spaceAbove || spaceAbove >= spaceBelow ? "above" : "below";
  const rawTop = side === "above" ? anchor.top - GAP - tip.height : anchor.top + anchor.height + GAP;
  const rawLeft = anchor.left + anchor.width / 2 - tip.width / 2;
  return {
    left: clamp(rawLeft, MARGIN, viewport.width - tip.width - MARGIN),
    top: clamp(rawTop, MARGIN, viewport.height - tip.height - MARGIN),
    side,
  };
}

/** Renders `data-tip` text in one body-level layer so containers with overflow or stacking cannot clip it. */
export function installFloatingTooltips(doc: Document = document): () => void {
  const view = doc.defaultView ?? window;
  const tip = doc.createElement("div");
  tip.className = "floating-tip";
  tip.setAttribute("aria-hidden", "true");
  doc.body.append(tip);
  let anchor: HTMLElement | null = null;

  const show = (target: HTMLElement) => {
    const text = target.dataset.tip?.trim();
    if (!text) return hide();
    anchor = target;
    tip.textContent = text;
    tip.classList.add("visible");
    const placement = placeTooltip(target.getBoundingClientRect(), tip.getBoundingClientRect(), { width: view.innerWidth, height: view.innerHeight });
    tip.style.left = `${placement.left}px`;
    tip.style.top = `${placement.top}px`;
    tip.dataset.side = placement.side;
  };
  const hide = () => {
    anchor = null;
    tip.classList.remove("visible");
  };
  const tipTarget = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null);

  const onOver = (event: Event) => {
    const target = tipTarget(event.target);
    if (target && target !== anchor) show(target);
  };
  const onOut = (event: Event) => {
    if (!anchor) return;
    const next = (event as FocusEvent | MouseEvent).relatedTarget;
    if (!(next instanceof Node && anchor.contains(next))) hide();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide();
  };

  doc.addEventListener("pointerover", onOver);
  doc.addEventListener("pointerout", onOut);
  doc.addEventListener("focusin", onOver);
  doc.addEventListener("focusout", onOut);
  doc.addEventListener("pointerdown", hide);
  doc.addEventListener("keydown", onKey);
  view.addEventListener("scroll", hide, true);
  view.addEventListener("resize", hide);
  return () => {
    doc.removeEventListener("pointerover", onOver);
    doc.removeEventListener("pointerout", onOut);
    doc.removeEventListener("focusin", onOver);
    doc.removeEventListener("focusout", onOut);
    doc.removeEventListener("pointerdown", hide);
    doc.removeEventListener("keydown", onKey);
    view.removeEventListener("scroll", hide, true);
    view.removeEventListener("resize", hide);
    tip.remove();
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}
