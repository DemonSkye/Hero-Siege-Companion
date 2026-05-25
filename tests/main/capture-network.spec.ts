import { describe, expect, test } from "vitest";
import type { CaptureConnection } from "../../src/shared/app-state";
import { connectionSignature, selectGameServerConnections, stableCaptureFilter, summarizeConnections, uniqueCaptureTargets } from "../../src/main/capture-network";

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
  test("filters launcher and web connections before capture selection", () => {
    const game = connection({ remotePort: 26921 });
    const web = connection({ remoteAddress: "198.51.100.1", remotePort: 443 });

    expect(selectGameServerConnections([web, game])).toEqual([game]);
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

  test("keeps capture filters narrow and logs connection summaries without process ids", () => {
    expect(stableCaptureFilter("10.0.0.2")).toBe("tcp and host 10.0.0.2 and not (port 80 or port 443) and len > 30");
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
});
