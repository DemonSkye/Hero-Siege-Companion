import { afterEach, describe, expect, test } from "vitest";
import { installFloatingTooltips, placeTooltip } from "../../src/renderer/src/lib/floating-tooltip";

const viewport = { width: 980, height: 700 };
const tip = { width: 280, height: 70 };

describe("placeTooltip", () => {
  test("centres above the anchor when there is room", () => {
    expect(placeTooltip({ left: 480, top: 300, width: 16, height: 16 }, tip, viewport)).toEqual({ left: 348, top: 222, side: "above" });
  });

  test("flips below an anchor near the top of the window", () => {
    expect(placeTooltip({ left: 480, top: 20, width: 16, height: 16 }, tip, viewport)).toMatchObject({ top: 44, side: "below" });
  });

  test("clamps inside both window edges", () => {
    expect(placeTooltip({ left: 2, top: 300, width: 16, height: 16 }, tip, viewport).left).toBe(8);
    expect(placeTooltip({ left: 970, top: 300, width: 16, height: 16 }, tip, viewport).left).toBe(980 - 280 - 8);
  });

  test("keeps a tooltip taller than both gaps inside the window", () => {
    const placement = placeTooltip({ left: 480, top: 340, width: 16, height: 16 }, { width: 280, height: 690 }, viewport);
    expect(placement.top).toBe(8);
  });
});

describe("installFloatingTooltips", () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => {
    uninstall?.();
    uninstall = null;
    document.body.innerHTML = "";
  });

  test("shows data-tip text in one body-level layer on hover and focus, and hides it on leave and Escape", () => {
    document.body.innerHTML = '<section style="overflow:hidden"><span id="a" tabindex="0" data-tip="Gold explainer">i</span></section><button id="b">b</button>';
    uninstall = installFloatingTooltips(document);
    const layer = document.body.querySelector(":scope > .floating-tip")!;
    const anchor = document.getElementById("a")!;

    anchor.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(layer.classList.contains("visible")).toBe(true);
    expect(layer.textContent).toBe("Gold explainer");
    expect(layer.getAttribute("aria-hidden")).toBe("true");

    anchor.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.getElementById("b") }));
    expect(layer.classList.contains("visible")).toBe(false);

    anchor.focus();
    expect(layer.classList.contains("visible")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(layer.classList.contains("visible")).toBe(false);
  });

  test("removes the layer when uninstalled", () => {
    uninstall = installFloatingTooltips(document);
    uninstall();
    uninstall = null;
    expect(document.querySelector(".floating-tip")).toBeNull();
  });
});
