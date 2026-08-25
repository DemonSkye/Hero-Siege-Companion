import { describe, expect, test, vi } from "vitest";
import { EVENT_NAMES } from "../../src/shared/constants";
import { GeneratedDropCorrelator, RecentEventDeduplicator } from "../../src/main/capture-event-state";
import type { MessageValue } from "../../src/shared/fields";
import { messageToEvents, type ParsedEvent } from "../../src/shared/parser";
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
    seq: 1,
    ack: 1,
    flags: 0x18,
    payloadLength: 1,
    payload: Buffer.from("x"),
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

  test("does not collapse equal XP gains that occur close together", () => {
    const deduplicator = new RecentEventDeduplicator(100);
    const xpEvent: ParsedEvent = { name: EVENT_NAMES.xp, value: 15, raw: {}, createdAt: 1 };

    expect(deduplicator.isDuplicate(xpEvent, 1000)).toBe(false);
    expect(deduplicator.isDuplicate(xpEvent, 1050)).toBe(false);
  });

  test("keeps the recent fingerprint cache within its configured bound", () => {
    const deduplicator = new RecentEventDeduplicator(1000, 2);

    expect(deduplicator.isDuplicate(event({ id: 1 }), 1000)).toBe(false);
    expect(deduplicator.isDuplicate(event({ id: 2 }), 1001)).toBe(false);
    expect(deduplicator.isDuplicate(event({ id: 3 }), 1002)).toBe(false);
    expect(deduplicator.size).toBe(2);
    expect(deduplicator.isDuplicate(event({ id: 2 }), 1003)).toBe(true);
    expect(deduplicator.isDuplicate(event({ id: 1 }), 1003)).toBe(false);
    expect(deduplicator.size).toBe(2);
  });

  test("marks an inbound generated item response only when its hash matches the outbound request", () => {
    const correlator = new GeneratedDropCorrelator(3000);
    const log = vi.fn();
    const response: MessageValue = { message: "OK", itemGenHash: "abc", itemData: { id: 123 } };

    correlator.markTrustedResponses(
      packet({ src: "10.0.0.2", dst: "203.0.113.8", srcPort: 54000, dstPort: 26921 }),
      [{ route: "inventory/item_generate/v1", item_gen_hash: "abc" }],
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
    expect(log).toHaveBeenCalledWith("generated-drop-correlated", {
      flow: "10.0.0.2:54000->203.0.113.8:26921",
      server: "203.0.113.8:26921",
      messages: 1,
      pendingRequests: 0,
    });
  });

  test("does not trust a mismatched response or consume the hashed pending request", () => {
    const correlator = new GeneratedDropCorrelator(3000);
    const log = vi.fn();
    const mismatchedResponse: MessageValue = { message: "OK", itemGenHash: "unexpected", itemData: { id: 123 } };
    const matchingResponse: MessageValue = { message: "OK", item_gen_hash: "expected", itemData: { id: 456 } };

    correlator.markTrustedResponses(
      packet({}),
      [{ route: "inventory/item_generate/v1", itemGenHash: "expected" }],
      "10.0.0.2",
      log,
      1000,
    );
    correlator.markTrustedResponses(
      packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54000 }),
      [mismatchedResponse],
      "10.0.0.2",
      log,
      1100,
    );
    correlator.markTrustedResponses(
      packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54000 }),
      [matchingResponse],
      "10.0.0.2",
      log,
      1200,
    );

    expect(mismatchedResponse).not.toHaveProperty("__hscTrustedGeneratedDrop");
    expect(matchingResponse).toMatchObject({ __hscTrustedGeneratedDrop: true });
    expect(log).toHaveBeenCalledTimes(1);
  });

  test("keeps the FIFO compatibility fallback for outbound requests without a captured hash", () => {
    const correlator = new GeneratedDropCorrelator(3000);
    const log = vi.fn();
    const firstResponse: MessageValue = { message: "OK", itemGenHash: "abc", itemData: { id: 123 } };
    const secondResponse: MessageValue = { message: "OK", itemGenHash: "def", itemData: { id: 456 } };

    correlator.markTrustedResponses(
      packet({ src: "10.0.0.2", dst: "203.0.113.8", srcPort: 54000, dstPort: 26921 }),
      [{ route: "inventory/item_generate/v1" }],
      "10.0.0.2",
      log,
      1000,
    );
    correlator.markTrustedResponses(
      packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54000 }),
      [firstResponse],
      "10.0.0.2",
      log,
      1500,
    );
    correlator.markTrustedResponses(
      packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54000 }),
      [secondResponse],
      "10.0.0.2",
      log,
      2000,
    );

    expect(firstResponse).toMatchObject({ __hscTrustedGeneratedDrop: true });
    expect(secondResponse).not.toHaveProperty("__hscTrustedGeneratedDrop");
    expect(log).toHaveBeenCalledTimes(1);
  });

  for (const { requestKind, responseAt, boundary } of [
    { requestKind: "hashed", responseAt: 4000, boundary: "at expiresAt" },
    { requestKind: "hashed", responseAt: 4001, boundary: "after expiresAt" },
    { requestKind: "hashless", responseAt: 4000, boundary: "at expiresAt" },
    { requestKind: "hashless", responseAt: 4001, boundary: "after expiresAt" },
  ]) {
    test(`does not trust an expired ${requestKind} request ${boundary}`, () => {
      const correlator = new GeneratedDropCorrelator(3000);
      const log = vi.fn();
      const response: MessageValue = { message: "OK", itemGenHash: "expires", itemData: { id: 123 } };
      const request: MessageValue = {
        route: "inventory/item_generate/v1",
        ...(requestKind === "hashed" ? { itemGenHash: "expires" } : {}),
      };

      correlator.markTrustedResponses(packet({}), [request], "10.0.0.2", log, 1000);
      correlator.markTrustedResponses(
        packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54000 }),
        [response],
        "10.0.0.2",
        log,
        responseAt,
      );

      expect(response).not.toHaveProperty("__hscTrustedGeneratedDrop");
      expect(log).not.toHaveBeenCalled();
    });
  }

  test("passes only a hash-matched correlated c0 stack response through messageToEvents", () => {
    const correlator = new GeneratedDropCorrelator(3000);
    const log = vi.fn();
    const generatedStackResponse = (itemGenHash: string): MessageValue => ({
      status: 1,
      message: "OK",
      itemGenHash,
      itemData: {
        "10-3909410-6526f7d8f85a20001-12": {
          e: 0,
          j: 0,
          gid: 4555085,
          b: 0,
          d: 3,
          c: 0,
          a: 741364673,
        },
      },
    });
    const mismatchedResponse = generatedStackResponse("unexpected");
    const matchingResponse = generatedStackResponse("expected");
    const inboundPacket = packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54000 });

    correlator.markTrustedResponses(
      packet({}),
      [{ route: "inventory/item_generate/v1", itemGenHash: "expected" }],
      "10.0.0.2",
      log,
      1000,
    );
    correlator.markTrustedResponses(inboundPacket, [mismatchedResponse], "10.0.0.2", log, 1100);
    correlator.markTrustedResponses(inboundPacket, [matchingResponse], "10.0.0.2", log, 1200);

    expect(messageToEvents([mismatchedResponse])).toEqual([]);
    expect(messageToEvents([matchingResponse])).toEqual([
      expect.objectContaining({
        name: EVENT_NAMES.itemDrop,
        value: expect.objectContaining({
          label: "Basic Key",
          source: "server",
          type: 12,
          id: 0,
        }),
      }),
    ]);
  });

  test("keeps generated-drop trust scoped to the originating local socket", () => {
    const correlator = new GeneratedDropCorrelator(3000);
    const log = vi.fn();
    const wrongFlowResponse: MessageValue = { message: "OK", itemGenHash: "wrong", itemData: { id: 1 } };
    const matchingResponse: MessageValue = { message: "OK", itemGenHash: "right", itemData: { id: 2 } };

    correlator.markTrustedResponses(
      packet({ srcPort: 54000 }),
      [{ route: "inventory/item_generate/v1" }],
      "10.0.0.2",
      log,
      1000,
    );
    correlator.markTrustedResponses(
      packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54001 }),
      [wrongFlowResponse],
      "10.0.0.2",
      log,
      1100,
    );
    correlator.markTrustedResponses(
      packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54000 }),
      [matchingResponse],
      "10.0.0.2",
      log,
      1200,
    );

    expect(wrongFlowResponse).not.toHaveProperty("__hscTrustedGeneratedDrop");
    expect(matchingResponse).toMatchObject({ __hscTrustedGeneratedDrop: true });
  });

  test("matches multiple hashed requests independently on one flow", () => {
    const correlator = new GeneratedDropCorrelator(3000);
    const log = vi.fn();
    const secondResponse: MessageValue = { message: "OK", itemGenHash: "second", itemData: { id: 2 } };
    const firstResponse: MessageValue = { message: "OK", itemGenHash: "first", itemData: { id: 1 } };

    correlator.markTrustedResponses(
      packet({}),
      [
        { route: "inventory/item_generate/v1", itemGenHash: "first" },
        { route: "inventory/item_generate/v1", item_gen_hash: "second" },
      ],
      "10.0.0.2",
      log,
      1000,
    );
    correlator.markTrustedResponses(
      packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54000 }),
      [secondResponse],
      "10.0.0.2",
      log,
      1100,
    );
    correlator.markTrustedResponses(
      packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54000 }),
      [firstResponse],
      "10.0.0.2",
      log,
      1200,
    );

    expect(firstResponse).toMatchObject({ __hscTrustedGeneratedDrop: true });
    expect(secondResponse).toMatchObject({ __hscTrustedGeneratedDrop: true });
    expect(log).toHaveBeenCalledTimes(2);
  });

  test("consumes the oldest request when duplicate hashes are pending", () => {
    const correlator = new GeneratedDropCorrelator(3000);
    const log = vi.fn();
    const firstResponse: MessageValue = { message: "OK", itemGenHash: "same", itemData: { id: 1 } };
    const secondResponse: MessageValue = { message: "OK", itemGenHash: "same", itemData: { id: 2 } };

    correlator.markTrustedResponses(
      packet({}),
      [{ route: "inventory/item_generate/v1", itemGenHash: "same" }],
      "10.0.0.2",
      log,
      1000,
    );
    correlator.markTrustedResponses(
      packet({}),
      [{ route: "inventory/item_generate/v1", itemGenHash: "same" }],
      "10.0.0.2",
      log,
      3000,
    );
    correlator.markTrustedResponses(
      packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54000 }),
      [firstResponse],
      "10.0.0.2",
      log,
      3500,
    );
    correlator.markTrustedResponses(
      packet({ src: "203.0.113.8", dst: "10.0.0.2", srcPort: 26921, dstPort: 54000 }),
      [secondResponse],
      "10.0.0.2",
      log,
      4500,
    );

    expect(firstResponse).toMatchObject({ __hscTrustedGeneratedDrop: true });
    expect(secondResponse).toMatchObject({ __hscTrustedGeneratedDrop: true });
  });
});
