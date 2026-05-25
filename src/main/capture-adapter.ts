import { createRequire } from "node:module";

const capRequire = createRequire(__filename);
const CAPTURE_BUFFER_BYTES = 10 * 1024 * 1024;

interface CapDeviceAddress {
  addr?: unknown;
}

interface CapDeviceInfo {
  name?: unknown;
  addresses?: CapDeviceAddress[];
}

export interface PacketCaptureHandle {
  close(): void;
}

interface NativePacketCapture extends PacketCaptureHandle {
  open(device: string, filter: string, bufferSize: number, buffer: Buffer): string;
  on(event: "packet", handler: (nbytes: number, truncated: boolean) => void): void;
}

interface CapConstructor {
  new (): NativePacketCapture;
  findDevice(localAddress: string): string | undefined;
  deviceList(): CapDeviceInfo[];
}

const { Cap } = capRequire("cap") as { Cap: CapConstructor };

export function findNpcapDevice(localAddress: string): string | undefined {
  return Cap.findDevice(localAddress);
}

export function listNpcapDevices(): string {
  return Cap.deviceList().map(formatDeviceInfo).join("; ");
}

export function openPacketCapture(
  device: string,
  filter: string,
  buffer: Buffer,
  onPacket: (nbytes: number, truncated: boolean) => void,
): { cap: PacketCaptureHandle; linkType: string } {
  const cap = new Cap();
  const linkType = cap.open(device, filter, CAPTURE_BUFFER_BYTES, buffer);
  cap.on("packet", onPacket);
  return { cap, linkType };
}

function formatDeviceInfo(deviceInfo: CapDeviceInfo): string {
  const name = String(deviceInfo.name ?? "unknown");
  const addresses = Array.isArray(deviceInfo.addresses)
    ? deviceInfo.addresses.map((address) => String(address.addr ?? "")).filter(Boolean).join(", ")
    : "";
  return `${name}${addresses ? ` (${addresses})` : ""}`;
}
