import {
  endpointKey,
  eventFingerprint,
  isGeneratedItemDataResponse,
  messageHasRoute,
  objectMessages,
} from "./capture-events";
import type { ParsedPayload } from "./packet-decoder";
import type { MessageValue } from "../shared/fields";
import type { ParsedEvent } from "../shared/parser";

const DEFAULT_EVENT_DEDUP_WINDOW_MS = 2500;
const DEFAULT_MAX_FINGERPRINTS = 1000;
const DEFAULT_PENDING_GENERATED_DROP_MS = 3000;

type DebugLog = (type: string, data: Record<string, unknown>) => void;

export class RecentEventDeduplicator {
  private readonly recentEventFingerprints = new Map<string, number>();

  constructor(
    private readonly dedupWindowMs = DEFAULT_EVENT_DEDUP_WINDOW_MS,
    private readonly maxFingerprints = DEFAULT_MAX_FINGERPRINTS,
  ) {}

  get size(): number {
    return this.recentEventFingerprints.size;
  }

  clear(): void {
    this.recentEventFingerprints.clear();
  }

  isDuplicate(event: ParsedEvent, now = Date.now()): boolean {
    this.prune(now);

    const fingerprint = eventFingerprint(event);
    const lastSeenAt = this.recentEventFingerprints.get(fingerprint);
    if (lastSeenAt && now - lastSeenAt <= this.dedupWindowMs) return true;

    this.recentEventFingerprints.set(fingerprint, now);
    return false;
  }

  private prune(now: number): void {
    if (this.recentEventFingerprints.size < this.maxFingerprints) return;

    for (const [fingerprint, seenAt] of this.recentEventFingerprints.entries()) {
      if (now - seenAt > this.dedupWindowMs) this.recentEventFingerprints.delete(fingerprint);
    }
  }
}

export class GeneratedDropCorrelator {
  private readonly pendingGeneratedDropRequests = new Map<string, number>();

  constructor(private readonly pendingDropMs = DEFAULT_PENDING_GENERATED_DROP_MS) {}

  clear(): void {
    this.pendingGeneratedDropRequests.clear();
  }

  markTrustedResponses(packet: ParsedPayload, messages: MessageValue[], activeLocalAddress: string, log: DebugLog, now = Date.now()): void {
    this.prune(now);

    if (isOutboundPacket(packet, activeLocalAddress) && messages.some((message) => messageHasRoute(message, /^inventory\/item_generate\/v1$/i))) {
      this.pendingGeneratedDropRequests.set(endpointKey(packet.dst, packet.dstPort), now + this.pendingDropMs);
      return;
    }

    if (!isInboundPacket(packet, activeLocalAddress)) return;
    const expiresAt = this.pendingGeneratedDropRequests.get(endpointKey(packet.src, packet.srcPort));
    if (!expiresAt || expiresAt <= now) return;

    let marked = 0;
    for (const message of objectMessages(messages)) {
      if (!isGeneratedItemDataResponse(message)) continue;
      message.__hscTrustedGeneratedDrop = true;
      marked += 1;
    }

    if (marked > 0) {
      this.pendingGeneratedDropRequests.delete(endpointKey(packet.src, packet.srcPort));
      log("generated-drop-correlated", {
        server: endpointKey(packet.src, packet.srcPort),
        messages: marked,
      });
    }
  }

  private prune(now: number): void {
    for (const [key, expiresAt] of this.pendingGeneratedDropRequests.entries()) {
      if (expiresAt <= now) this.pendingGeneratedDropRequests.delete(key);
    }
  }
}

function isOutboundPacket(packet: ParsedPayload, activeLocalAddress: string): boolean {
  return Boolean(activeLocalAddress) && packet.src === activeLocalAddress;
}

function isInboundPacket(packet: ParsedPayload, activeLocalAddress: string): boolean {
  return Boolean(activeLocalAddress) && packet.dst === activeLocalAddress;
}
