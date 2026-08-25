import {
  endpointKey,
  eventFingerprint,
  isGeneratedItemDataResponse,
  messageHasRoute,
  objectMessages,
} from "./capture-events";
import type { ParsedPayload } from "./packet-decoder";
import { EVENT_NAMES } from "../shared/constants";
import type { MessageValue } from "../shared/fields";
import type { ParsedEvent } from "../shared/parser";

const DEFAULT_EVENT_DEDUP_WINDOW_MS = 2500;
const DEFAULT_MAX_FINGERPRINTS = 1000;
const DEFAULT_PENDING_GENERATED_DROP_MS = 3000;
const MAX_PENDING_GENERATED_DROPS_PER_FLOW = 100;

type DebugLog = (type: string, data: Record<string, unknown>) => void;

interface PendingGeneratedDropRequest {
  expiresAt: number;
  itemGenHash?: string;
}

export class RecentEventDeduplicator {
  private readonly recentEventFingerprints = new Map<string, number>();
  private readonly maxFingerprints: number;

  constructor(
    private readonly dedupWindowMs = DEFAULT_EVENT_DEDUP_WINDOW_MS,
    maxFingerprints = DEFAULT_MAX_FINGERPRINTS,
  ) {
    this.maxFingerprints = Math.max(1, maxFingerprints);
  }

  get size(): number {
    return this.recentEventFingerprints.size;
  }

  clear(): void {
    this.recentEventFingerprints.clear();
  }

  isDuplicate(event: ParsedEvent, now = Date.now()): boolean {
    // Equal XP gains can legitimately occur back-to-back; TCP retransmissions
    // are handled by PacketBuffers and must not be confused with repeated gains.
    if (event.name === EVENT_NAMES.xp) return false;

    const fingerprint = eventFingerprint(event);
    const lastSeenAt = this.recentEventFingerprints.get(fingerprint);
    if (lastSeenAt !== undefined && now - lastSeenAt <= this.dedupWindowMs) return true;

    this.recentEventFingerprints.delete(fingerprint);
    this.recentEventFingerprints.set(fingerprint, now);
    this.prune(now);
    return false;
  }

  private prune(now: number): void {
    if (this.recentEventFingerprints.size <= this.maxFingerprints) return;

    for (const [fingerprint, seenAt] of this.recentEventFingerprints.entries()) {
      if (now - seenAt > this.dedupWindowMs) this.recentEventFingerprints.delete(fingerprint);
    }
    while (this.recentEventFingerprints.size > this.maxFingerprints) {
      const oldest = this.recentEventFingerprints.keys().next().value as string | undefined;
      if (!oldest) return;
      this.recentEventFingerprints.delete(oldest);
    }
  }
}

export class GeneratedDropCorrelator {
  private readonly pendingGeneratedDropRequests = new Map<string, PendingGeneratedDropRequest[]>();

  constructor(private readonly pendingDropMs = DEFAULT_PENDING_GENERATED_DROP_MS) {}

  clear(): void {
    this.pendingGeneratedDropRequests.clear();
  }

  markTrustedResponses(packet: ParsedPayload, messages: MessageValue[], activeLocalAddress: string, log: DebugLog, now = Date.now()): void {
    this.prune(now);

    const flowKey = generatedDropFlowKey(packet, activeLocalAddress);
    if (!flowKey) return;

    if (isOutboundPacket(packet, activeLocalAddress)) {
      const requests = objectMessages(messages).filter((message) => messageHasRoute(message, /^inventory\/item_generate\/v1$/i));
      if (requests.length === 0) return;
      const pending = this.pendingGeneratedDropRequests.get(flowKey) ?? [];
      for (const request of requests) {
        const itemGenHash = generatedDropHash(request);
        pending.push({
          expiresAt: now + this.pendingDropMs,
          ...(itemGenHash ? { itemGenHash } : {}),
        });
      }
      if (pending.length > MAX_PENDING_GENERATED_DROPS_PER_FLOW) {
        pending.splice(0, pending.length - MAX_PENDING_GENERATED_DROPS_PER_FLOW);
      }
      this.pendingGeneratedDropRequests.set(flowKey, pending);
      return;
    }

    if (!isInboundPacket(packet, activeLocalAddress)) return;
    const pending = this.pendingGeneratedDropRequests.get(flowKey);
    if (!pending?.length) return;

    let marked = 0;
    for (const message of objectMessages(messages)) {
      if (!isGeneratedItemDataResponse(message)) continue;
      const responseHash = generatedDropHash(message);
      if (!responseHash) continue;

      // Prefer an exact hash even when an older hashless compatibility request
      // exists. A response with the wrong hash must leave hashed requests intact.
      const exactMatchIndex = pending.findIndex((request) => request.itemGenHash === responseHash);
      const fallbackIndex = exactMatchIndex >= 0 ? -1 : pending.findIndex((request) => !request.itemGenHash);
      const matchIndex = exactMatchIndex >= 0 ? exactMatchIndex : fallbackIndex;
      if (matchIndex < 0) continue;

      pending.splice(matchIndex, 1);
      message.__hscTrustedGeneratedDrop = true;
      marked += 1;
    }

    if (marked > 0) {
      if (pending.length === 0) this.pendingGeneratedDropRequests.delete(flowKey);
      log("generated-drop-correlated", {
        flow: flowKey,
        server: endpointKey(packet.src, packet.srcPort),
        messages: marked,
        pendingRequests: pending.length,
      });
    }
  }

  private prune(now: number): void {
    for (const [key, pending] of this.pendingGeneratedDropRequests.entries()) {
      const active = pending.filter((request) => request.expiresAt > now);
      if (active.length > 0) this.pendingGeneratedDropRequests.set(key, active);
      else this.pendingGeneratedDropRequests.delete(key);
    }
  }
}

function generatedDropHash(value: MessageValue): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, MessageValue>;
  for (const rawHash of [message.itemGenHash, message.item_gen_hash]) {
    if (typeof rawHash !== "string") continue;
    const hash = rawHash.trim();
    if (hash) return hash;
  }
  return null;
}

function generatedDropFlowKey(packet: ParsedPayload, activeLocalAddress: string): string | null {
  if (!activeLocalAddress) return null;
  if (packet.src === activeLocalAddress) return `${packet.src}:${packet.srcPort}->${packet.dst}:${packet.dstPort}`;
  if (packet.dst === activeLocalAddress) return `${packet.dst}:${packet.dstPort}->${packet.src}:${packet.srcPort}`;
  return null;
}

function isOutboundPacket(packet: ParsedPayload, activeLocalAddress: string): boolean {
  return Boolean(activeLocalAddress) && packet.src === activeLocalAddress;
}

function isInboundPacket(packet: ParsedPayload, activeLocalAddress: string): boolean {
  return Boolean(activeLocalAddress) && packet.dst === activeLocalAddress;
}
