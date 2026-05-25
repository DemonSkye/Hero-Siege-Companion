import { describe, expect, test } from "vitest";
import { EVENT_NAMES } from "../../src/shared/constants";
import type { ParsedEvent } from "../../src/shared/parser";
import {
  endpointKey,
  isGeneratedItemDataResponse,
  messageKeySummary,
  shouldDebugPayload,
  shouldLogEvent,
  summarizeEvent,
} from "../../src/main/capture-events";

function event(name: ParsedEvent["name"], value: unknown = {}): ParsedEvent {
  return { name, value, raw: {}, createdAt: 1 };
}

describe("capture event helpers", () => {
  test("identifies payloads worth retaining in debug logs", () => {
    expect(shouldDebugPayload("ordinary heartbeat", [], [])).toBe(false);
    expect(shouldDebugPayload("ordinary heartbeat", [], [event(EVENT_NAMES.gold)])).toBe(true);
    expect(shouldDebugPayload("status", [{ route: "mailbox/list" }], [])).toBe(true);
  });

  test("recognizes trusted generated item responses", () => {
    expect(isGeneratedItemDataResponse({ message: "OK", itemGenHash: "abc", itemData: { id: 1 } })).toBe(true);
    expect(isGeneratedItemDataResponse({ message: "OK", itemData: { id: 1 } })).toBe(false);
    expect(isGeneratedItemDataResponse({ message: "fail", itemGenHash: "abc", itemData: { id: 1 } })).toBe(false);
  });

  test("formats log summaries without leaking noisy helper details into capture service", () => {
    expect(endpointKey("203.0.113.5", 26921)).toBe("203.0.113.5:26921");
    expect(messageKeySummary({ alpha: 1, "bad key": 2, beta: 3 })).toBe("alpha,beta");
    expect(shouldLogEvent(event(EVENT_NAMES.accountMode))).toBe(false);
    expect(summarizeEvent(event(EVENT_NAMES.mail, true))).toBe("Parsed updateMail: true");
  });
});
