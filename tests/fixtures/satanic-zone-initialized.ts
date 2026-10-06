import { connectDiagnosticBody, requestDiagnosticBody } from "./satanic-zone-diagnostic-frames";
export const inventedProbeScope = { localAddress: "192.0.2.10", remoteAddress: "198.51.100.20", remotePort: 6669 };
export const inventedProbeIdentity = { uniqueAccountId: "12345678901234567890", beta: "0" };
export function inventedConnect() {
  return connectDiagnosticBody(JSON.stringify({ account: "CANARY_ACCOUNT", account_uid: inventedProbeIdentity.uniqueAccountId, checksum: "CANARY_CHECKSUM" }));
}
export function inventedPostLogin(uid = inventedProbeIdentity.uniqueAccountId, beta = "0") {
  return requestDiagnosticBody(3, "post_login_crossregion", 83,
    `account_id=CANARY_ACCOUNT&unique_account_id=${uid}&platform=0&checksum=${"a".repeat(64)}&guild_id=0&pact_ids=W10=&beta=${beta}`);
}
export function genericProbeFrame(body: Buffer) {
  const header = Buffer.alloc(8); header.writeUInt32LE(body.length, 4); return Buffer.concat([header, body]);
}
// Invented string value in the source-supported u16 + type-11 string shape.
export const inventedReadyBody = Buffer.concat([Buffer.from([0, 16]), Buffer.from("CANARY_ACK\0")]);
// Synthetic opcode-only variant: known 0x1000 dispatch, no recovered login bytes.
export const opcodeOnlyReadyBody = Buffer.from([0, 16]);
export function inventedLoginSuccess(json = '{"status":1,"globalIdentifier":"9876543210"}') {
  return Buffer.concat([Buffer.from([83, 0]), Buffer.from(json + "\0")]);
}
export const inventedZoneBody = Buffer.from('{"satanicZoneName":"Act_04_03","buffs":"","debuffs":""}');
