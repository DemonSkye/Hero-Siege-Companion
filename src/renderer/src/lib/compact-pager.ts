import { computed, ref, watch, type Ref } from "vue";
import type { CompactNavigationConfig } from "./compact-pages";

const WHEEL_THRESHOLD = 40;
const WHEEL_COOLDOWN_MS = 320;
const WHEEL_IDLE_RESET_MS = 180;

interface WheelLike {
  deltaY: number;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  preventDefault(): void;
}

interface KeyLike {
  key: string;
  target: EventTarget | null;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  preventDefault(): void;
}

export function useCompactPager(pageCount: Ref<number>, navigation: Ref<CompactNavigationConfig>, now: () => number = Date.now) {
  const index = ref(0);
  const direction = ref<1 | -1>(1);
  let wheelTotal = 0;
  let lastWheelAt = 0;
  let lastTurnAt = -Infinity;

  watch(pageCount, (count) => { if (index.value >= count) index.value = Math.max(count - 1, 0); });

  function go(target: number, travel: 1 | -1 = target > index.value ? 1 : -1): boolean {
    const count = pageCount.value;
    if (count <= 1) return false;
    let next = target;
    if (next < 0 || next >= count) {
      if (!navigation.value.wrap) return false;
      next = (next + count) % count;
    }
    if (next === index.value) return false;
    direction.value = travel;
    index.value = next;
    return true;
  }

  const step = (delta: 1 | -1) => go(index.value + delta, delta);

  function onWheel(event: WheelLike): void {
    if (!navigation.value.wheel || pageCount.value <= 1 || event.deltaY === 0) return;
    if (canScrollInside(event.target, event.currentTarget, event.deltaY)) return;
    event.preventDefault();
    const at = now();
    if (at - lastWheelAt > WHEEL_IDLE_RESET_MS) wheelTotal = 0;
    lastWheelAt = at;
    wheelTotal += event.deltaY;
    if (Math.abs(wheelTotal) < WHEEL_THRESHOLD || at - lastTurnAt < WHEEL_COOLDOWN_MS) return;
    const delta = wheelTotal > 0 ? 1 : -1;
    wheelTotal = 0;
    if (step(delta)) lastTurnAt = at;
  }

  function onKeydown(event: KeyLike): void {
    if (event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    const { arrowKeys, pageKeys } = navigation.value;
    const delta = arrowKeys && (event.key === "ArrowDown" || event.key === "ArrowRight") ? 1
      : arrowKeys && (event.key === "ArrowUp" || event.key === "ArrowLeft") ? -1
        : pageKeys && event.key === "PageDown" ? 1
          : pageKeys && event.key === "PageUp" ? -1 : 0;
    if (delta) {
      event.preventDefault();
      step(delta);
    } else if ((arrowKeys || pageKeys) && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      go(event.key === "Home" ? 0 : pageCount.value - 1);
    }
  }

  return { index: computed(() => Math.min(index.value, Math.max(pageCount.value - 1, 0))), direction, go, step, onWheel, onKeydown };
}

function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest?.("input, select, textarea, [contenteditable='true']"));
}

/** Lets a scrollable list inside a page (zone effects) scroll before the wheel turns the page. */
function canScrollInside(target: EventTarget | null, boundary: EventTarget | null, deltaY: number): boolean {
  let element = target as HTMLElement | null;
  while (element && element !== boundary) {
    if (element.scrollHeight > element.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(element).overflowY)) {
      if (deltaY > 0 ? element.scrollTop + element.clientHeight < element.scrollHeight - 1 : element.scrollTop > 0) return true;
    }
    element = element.parentElement;
  }
  return false;
}
