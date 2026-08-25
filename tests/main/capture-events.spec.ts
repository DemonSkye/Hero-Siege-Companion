import { describe, expect, test } from "vitest";
import { EVENT_NAMES } from "../../src/shared/constants";
import type { ParsedEvent } from "../../src/shared/parser";
import {
  captureEventsForRunStatus,
  endpointKey,
  eventDebugSummary,
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
  test("keeps Satanic Zone state live while run counters are paused", () => {
    const itemEvent = event(EVENT_NAMES.item, { id: 1 });
    const zoneEvent = event(EVENT_NAMES.satanicZone, { rawZone: "Act_08_03" });
    const mailEvent = event(EVENT_NAMES.mail, true);
    const events = [itemEvent, zoneEvent, mailEvent];

    expect(captureEventsForRunStatus(events, "recording")).toBe(events);
    expect(captureEventsForRunStatus(events, "paused")).toEqual([zoneEvent]);
  });

  test("identifies payloads worth retaining in debug logs", () => {
    expect(shouldDebugPayload("ordinary heartbeat", [], [])).toBe(false);
    expect(shouldDebugPayload("ordinary heartbeat", [], [event(EVENT_NAMES.gold)])).toBe(true);
    expect(shouldDebugPayload("status", [{ route: "mailbox/list" }], [])).toBe(true);
    expect(shouldDebugPayload("status", [{ route: "satanic_zone_get" }], [])).toBe(true);
    expect(shouldDebugPayload("f0a2 satanic_zone_getRunique_account_id=3437205", [], [])).toBe(true);
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

  test("creates structured parsed-event debug summaries", () => {
    expect(
      eventDebugSummary({
        name: EVENT_NAMES.item,
        value: { label: "Rotten Pumpkin", source: "inventory", type: 10, id: 54 },
        raw: {
          route: "inventory/item_stack_handler/v1",
          message: "Success on inventory update ext",
          item_data: { b: 54 },
        },
        createdAt: 1,
      }),
    ).toEqual({
      name: EVENT_NAMES.item,
      value: { label: "Rotten Pumpkin", source: "inventory", type: 10, id: 54 },
      rawKeys: "route,message,item_data",
      route: "inventory/item_stack_handler/v1",
      message: "Success on inventory update ext",
    });
  });
});
