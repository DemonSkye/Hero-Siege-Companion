import zlib from "node:zlib";

export interface ZipArchiveEntry {
  name: string;
  data: Buffer;
  modifiedAt: Date;
}

interface ZipCentralDirectoryInput {
  nameBuffer: Buffer;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  dosTime: number;
  dosDate: number;
  localHeaderOffset: number;
}

export function createZipArchive(entries: ZipArchiveEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralInputs: ZipCentralDirectoryInput[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = safeZipEntryName(entry.name);
    const nameBuffer = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);
    const { dosTime, dosDate } = dateToDos(entry.modifiedAt);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, compressed);
    centralInputs.push({
      nameBuffer,
      crc,
      compressedSize: compressed.length,
      uncompressedSize: entry.data.length,
      compressionMethod: 8,
      dosTime,
      dosDate,
      localHeaderOffset: offset,
    });
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralDirectoryOffset = offset;
  const centralParts = centralInputs.map((input) => {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(input.compressionMethod, 10);
    header.writeUInt16LE(input.dosTime, 12);
    header.writeUInt16LE(input.dosDate, 14);
    header.writeUInt32LE(input.crc, 16);
    header.writeUInt32LE(input.compressedSize, 20);
    header.writeUInt32LE(input.uncompressedSize, 24);
    header.writeUInt16LE(input.nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(input.localHeaderOffset, 42);
    offset += header.length + input.nameBuffer.length;
    return Buffer.concat([header, input.nameBuffer]);
  });

  const centralDirectorySize = offset - centralDirectoryOffset;
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(centralInputs.length, 8);
  endOfCentralDirectory.writeUInt16LE(centralInputs.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, endOfCentralDirectory]);
}

function safeZipEntryName(name: string): string {
  return name.replace(/\\/g, "/").split("/").map(safeZipNamePart).filter(Boolean).join("/") || "file";
}

function safeZipNamePart(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "") || "file";
}

function dateToDos(date: Date): { dosTime: number; dosDate: number } {
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  const year = Math.max(1980, Math.min(2107, safeDate.getFullYear()));
  const dosTime = (safeDate.getHours() << 11) | (safeDate.getMinutes() << 5) | Math.floor(safeDate.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((safeDate.getMonth() + 1) << 5) | safeDate.getDate();
  return { dosTime, dosDate };
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}
