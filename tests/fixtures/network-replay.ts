import evidence from "./network-replay-evidence.json";
import { connectDiagnosticBody, frameDiagnosticBody, requestDiagnosticBody } from "./satanic-zone-diagnostic-frames";
import { genericProbeFrame, inventedLoginSuccess, inventedProbeIdentity, inventedProbeScope, inventedZoneBody } from "./satanic-zone-initialized";

export { evidence, inventedProbeScope as replayScope };
export const replayUid = inventedProbeIdentity.uniqueAccountId;
export const replayMarketIdentifier = "1111111111";
export const replayOwnedIdentifier = "2222222222";
export const replayConnect = () => connectDiagnosticBody(JSON.stringify({ account: "42", account_uid: replayUid, checksum: "CANARY_CHECKSUM" }));
export const replayPostLogin = () => requestDiagnosticBody(3, "post_login_crossregion", evidence.initialization.postLoginMode,
  `account_id=42&unique_account_id=${replayUid}&platform=0&checksum=${"a".repeat(64)}&guild_id=0&pact_ids=W10=&beta=0`);
export const replayIdentity = () => requestDiagnosticBody(3, "mailbox/get_mail", 83,
  `account_id=na-42&unique_account_id=${replayUid}&crossregion_identifier=${replayMarketIdentifier}&season=11&hardcore=0&beta=0`);
export const replayAck = Buffer.from([0, 16]);
export const replayLogin = () => inventedLoginSuccess(`{"status":1,"globalIdentifier":"${replayOwnedIdentifier}"}`);
export const replayMarketRequest = { itemMask: JSON.parse(evidence.marketSearch.publicFields.filter_masks)[0] as number, statFilters: [] };
// Observed HTTP/application status and safe category; the original response text is unavailable.
export const replayChecksumRejection = Buffer.from(JSON.stringify({ status: evidence.marketRejection.applicationStatus, message: "checksum" }));

export interface ReplaySegment { outbound: boolean; sequence: number; payload: Buffer; flags: number; }

/** Ethernet/TCP headers, addresses, counters and credentials are invented. */
export function replayPacket(segment: ReplaySegment, localPort = 5000): Buffer {
  const packet = Buffer.alloc(54 + segment.payload.length), ip = 14, tcp = 34;
  packet.writeUInt16BE(0x0800, 12); packet[ip] = 0x45;
  packet.writeUInt16BE(40 + segment.payload.length, ip + 2); packet[ip + 8] = 64; packet[ip + 9] = 6;
  const local = [192, 0, 2, 10], remote = [198, 51, 100, 20];
  packet.set(segment.outbound ? local : remote, ip + 12); packet.set(segment.outbound ? remote : local, ip + 16);
  packet.writeUInt16BE(segment.outbound ? localPort : inventedProbeScope.remotePort, tcp);
  packet.writeUInt16BE(segment.outbound ? inventedProbeScope.remotePort : localPort, tcp + 2);
  packet.writeUInt32BE(segment.sequence, tcp + 4); packet.writeUInt32BE(segment.outbound ? 201 : 101, tcp + 8);
  packet[tcp + 12] = 0x50; packet[tcp + 13] = segment.flags; segment.payload.copy(packet, tcp + 20);
  return packet;
}

// Deliberately invented fragmentation, out-of-order delivery and duplicate, not captured geometry.
export function fragmentedFrame(outbound: boolean, sequence: number, frame: Buffer): ReplaySegment[] {
  const at = [0, 9, 23, frame.length];
  const parts = at.slice(0, -1).map((offset, index) => ({ outbound, sequence: sequence + offset,
    payload: frame.subarray(offset, at[index + 1]), flags: 24 }));
  return [parts[0], parts[2], parts[1], parts[1]];
}

/** Source-supported initialization order; login packet bytes are entirely substituted. */
export function replayInitialization(): ReplaySegment[] {
  const connect = frameDiagnosticBody(replayConnect(), 7), ack = genericProbeFrame(replayAck);
  const postLogin = frameDiagnosticBody(replayPostLogin(), 8), login = genericProbeFrame(replayLogin());
  return [
    { outbound: true, sequence: 100, payload: Buffer.alloc(0), flags: 2 },
    { outbound: false, sequence: 200, payload: Buffer.alloc(0), flags: 18 },
    ...fragmentedFrame(true, 101, connect),
    { outbound: false, sequence: 201, payload: ack, flags: 24 },
    ...fragmentedFrame(true, 101 + connect.length, postLogin),
    ...fragmentedFrame(false, 201 + ack.length, login),
    ...fragmentedFrame(true, 101 + connect.length + postLogin.length, frameDiagnosticBody(replayIdentity(), 9)),
    // Only payload/packet lengths and flags derive from retained passive SZ packet metadata.
    { outbound: false, sequence: 201 + ack.length + login.length,
      payload: genericProbeFrame(Buffer.from(inventedZoneBody.toString().padEnd(evidence.passiveZone.payloadLength - 8, " "))),
      flags: evidence.passiveZone.tcpFlags },
  ];
}
