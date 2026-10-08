import { expect, test } from "vitest";
import { itemBaseSocketRange } from "../../src/shared/item-socket-capacity";

// Literal retained constructor facts, not populated-slot or production-derived
// expected values. These remain build-scoped; they do not prove current parity.
test.each([
  ["unique:1:0:100", 2, 4], // Sharpshooter's Cloak
  ["unique:6:0:38", 2, 4], // Battle Mage's Shield
  ["unique:4:0:18", 1, 2], // Zealot's Deathbringers: positive glove exception
  ["unique:4:0:30", 1, 3], // St. Ahto's Diamond Hands
  ["normal:7:0:15", 1, 1], // Explicit scalar normal-item capacity
  ["unique:3:16:0", 0, 2], // Zero is a real lower capacity bound, not Any
  ["unique:10:0:67", 1, 4], // Tablet Of Awakening: positive charm exception
  ["unique:10:0:81", 1, 1], // Dragon's Heart: positive charm exception
] as const)("retains explicit socket capacity for %s", (key, minimum, maximum) => {
  expect(itemBaseSocketRange(key)).toEqual({ minimum, maximum });
});

test.each([null, "unique:4:0:0", "unique:10:0:92", "normal:3:1:0", "runeword-repository:81", "unknown"])(
  "does not infer capacity for %s from type, name or socket-key presence", key => {
    expect(itemBaseSocketRange(key)).toBeNull();
  },
);

test("legacy runeword alias remains unknown without recipe/capacity evidence", () => {
  expect(itemBaseSocketRange("runeword:3:0:0")).toBeNull();
});
