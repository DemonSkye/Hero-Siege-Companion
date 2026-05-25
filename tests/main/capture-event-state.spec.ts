import { describe, expect, test, vi } from "vitest";
import { EVENT_NAMES } from "../../src/shared/constants";
import { GeneratedDropCorrelator, RecentEventDeduplicator } from "../../src/main/capture-event-state";
import type { MessageValue } from "../../src/shared/fields";
import type { ParsedEvent } from "../../src/shared/parser";
import type { ParsedPayload } from "../../src/main/packet-decoder";

function event(value: unknown): ParsedEvent {
  return { name: EVENT_NAMES.item, value, raw: {}, createdAt: 1 };
}

function packet(overrides: Partial<ParsedPayload>): ParsedPayload {
  return {
    src: "10.0.0.2",
    dst: "203.0.113.8",
    srcPort: 54000,
    dstPort: 26921,
    ack: 1,
    payloadLength: 1,
    payloadBase64: "",
    text: "",
    ...overrides,
  };
}

describe("capture event state", () => {
  test("deduplicates repeated parsed events within the configured window", () => {
    const deduplicator = new RecentEventDeduplicator(100);
    const parsedEvent = event({ id: 123 });

    expect(deduplicator.isDuplicate(parsedEvent, 1000)).toBe(false);
    expect(deduplicator.isDuplicate(parsedEvent, 1050)).toBe(true);
    expect(deduplicator.isDuplicate(parsedEvent, 1201)).toBe(false);
  });

  test("marks inbound generated item responses that match a recent outbound request", () => {
    const correlator = new GeneratedDropCorrelator(3000);
    const log = vi.fn();
    const response: MessageValue = { message: "OK", itemGenHash: "abc", itemData: { id: 123 } };

    correlator.markTrustedResponses(
      packet({ src: "10.0.0.2", dst: "203.0.113.8", srcPort: 54000, dstPort: 26921 }),
      [{ route: "inventory/item_generate/v1" }],
      "10.0.0.2",
      log,
      1000,
    );
    correlator.markTrustedResponses(
      packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54000 }),
      [response],
      "10.0.0.2",
      log,
      1500,
    );

    expect(response).toMatchObject({ __hscTrustedGeneratedDrop: true });
    expect(log).toHaveBeenCalledWith("generated-drop-correlated", { server: "203.0.113.8:26921", messages: 1 });
  });
});
