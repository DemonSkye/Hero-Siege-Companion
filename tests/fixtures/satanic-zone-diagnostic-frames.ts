import { createHash } from "node:crypto";

// Invented wire-shaped fixtures; these are not recovered game/session bytes.
export function connectDiagnosticBody(json = JSON.stringify({ account: "CANARY_ACCOUNT", account_uid: "CANARY_UID", checksum: "CANARY_CHECKSUM" }),
  mode = 1, digest = "0123456789abcdef0123456789abcdef"): Buffer {
  return Buffer.concat([Buffer.from([0, 0, mode]), Buffer.from(json + "\0" + digest + "\0", "utf8")]);
}

export function requestDiagnosticBody(opcode: 2 | 3, command = "CANARY_UNKNOWN_COMMAND", mode = 93,
  args = "CANARY_PRIVATE_ARGUMENTS", region = 1): Buffer {
  const prefix = Buffer.alloc(opcode === 3 ? 4 : 2); prefix.writeUInt16LE(opcode);
  if (opcode === 3) prefix.writeUInt16LE(region, 2);
  const modeBytes = Buffer.alloc(2); modeBytes.writeUInt16LE(mode);
  return Buffer.concat([prefix, Buffer.from(command + "\0", "utf8"), modeBytes, Buffer.from(args + "\0", "utf8")]);
}

export function frameDiagnosticBody(body: Buffer, counter: number): Buffer {
  const token = createHash("md5").update(body).update(Buffer.from([counter])).digest("hex").slice(0, 12);
  const header = Buffer.alloc(16); header.write(token); header.writeUInt32LE(body.length, 12);
  return Buffer.concat([header, body]);
}
