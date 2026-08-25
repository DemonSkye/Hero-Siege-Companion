import { describe, expect, test } from "vitest";
import type { CaptureConnection } from "../../src/shared/app-state";
import {
  captureConnectionFlowKey,
  capturePacketFlowKey,
  connectionSignature,
  normalizeCaptureProcessIds,
  refreshRetainedCaptureTargets,
  selectGameServerConnections,
  stableCaptureFilter,
  summarizeConnections,
  uniqueCaptureTargets,
} from "../../src/main/capture-network";

function connection(overrides: Partial<CaptureConnection> = {}): CaptureConnection {
  return {
    owningProcess: 123,
    state: "Established",
    localAddress: "192.168.1.10",
    localPort: 50000,
    remoteAddress: "203.0.113.10",
    remotePort: 26921,
    ...overrides,
  };
}

describe("capture network helpers", () => {
  test("normalizes supplemental relay process IDs before discovery interpolation", () => {
    expect(normalizeCaptureProcessIds([42, -1, 7, 42, Number.NaN, 2.5, 0x80000000])).toEqual([7, 42]);
  });

  test("filters launcher and web connections before capture selection", () => {
    const game = connection({ remotePort: 26921 });
    const web = connection({ remoteAddress: "198.51.100.1", remotePort: 443 });
    const closing = connection({ remoteAddress: "198.51.100.2", remotePort: 6601, state: "8" });
    const connecting = connection({ remoteAddress: "198.51.100.3", remotePort: 6601, state: "SynSent" });

    expect(selectGameServerConnections([web, closing, connecting, game])).toEqual([connecting, game]);
  });

  test("creates stable unique capture targets and signatures", () => {
    const first = connection({ localAddress: "10.0.0.2", remoteAddress: "203.0.113.20", remotePort: 3000 });
    const duplicate = connection({ localAddress: "10.0.0.2", remoteAddress: "203.0.113.20", remotePort: 3000, localPort: 50001 });
    const second = connection({ localAddress: "10.0.0.2", remoteAddress: "203.0.113.21", remotePort: 3001 });

    expect(uniqueCaptureTargets([first, duplicate, second])).toEqual([
      { remoteAddress: "203.0.113.20", remotePort: 3000 },
      { remoteAddress: "203.0.113.21", remotePort: 3001 },
    ]);
    expect(connectionSignature([second, duplicate, first])).toBe("10.0.0.2->203.0.113.20:3000|10.0.0.2->203.0.113.21:3001");
  });

  test("retains recently closed targets while adding new targets immediately", () => {
    const retained = new Map();
    const first = connection({ remoteAddress: "203.0.113.20", remotePort: 3000 });
    const second = connection({ remoteAddress: "203.0.113.21", remotePort: 3001 });

    expect(refreshRetainedCaptureTargets(retained, [first], 1000, 3000)).toEqual([{ remoteAddress: "203.0.113.20", remotePort: 3000 }]);
    expect(refreshRetainedCaptureTargets(retained, [second], 2000, 3000)).toEqual([
      { remoteAddress: "203.0.113.20", remotePort: 3000 },
      { remoteAddress: "203.0.113.21", remotePort: 3001 },
    ]);
    expect(refreshRetainedCaptureTargets(retained, [second], 4000, 3000)).toEqual([{ remoteAddress: "203.0.113.21", remotePort: 3001 }]);
  });

  test("keeps capture filters narrow and logs connection summaries without process ids", () => {
    expect(stableCaptureFilter("10.0.0.2", [])).toBe("tcp and host 10.0.0.2 and not (port 80 or port 443) and len > 30");
    expect(
      stableCaptureFilter("10.0.0.2", [
        { remoteAddress: "203.0.113.10", remotePort: 6668 },
        { remoteAddress: "203.0.113.10", remotePort: 6668 },
        { remoteAddress: "203.0.113.20", remotePort: 6600 },
      ]),
    ).toBe(
      "tcp and host 10.0.0.2 and ((host 203.0.113.10 and port 6668) or (host 203.0.113.20 and port 6600)) and len > 30",
    );
    expect(summarizeConnections([connection({ owningProcess: 999 })])).toEqual([
      {
        state: "Established",
        localAddress: "192.168.1.10",
        localPort: 50000,
        remoteAddress: "203.0.113.10",
        remotePort: 26921,
      },
    ]);
  });

  test("normalizes both packet directions to the process-owned four-tuple", () => {
    const game = connection({ localAddress: "10.0.0.2", localPort: 50000, remoteAddress: "203.0.113.10", remotePort: 6668 });
    const key = "10.0.0.2:50000->203.0.113.10:6668";

    expect(captureConnectionFlowKey(game)).toBe(key);
    expect(capturePacketFlowKey({ src: "10.0.0.2", srcPort: 50000, dst: "203.0.113.10", dstPort: 6668 }, "10.0.0.2")).toBe(key);
    expect(capturePacketFlowKey({ src: "203.0.113.10", srcPort: 6668, dst: "10.0.0.2", dstPort: 50000 }, "10.0.0.2")).toBe(key);
    expect(capturePacketFlowKey({ src: "10.0.0.2", srcPort: 50001, dst: "203.0.113.10", dstPort: 6668 }, "10.0.0.2")).not.toBe(key);
  });
});
