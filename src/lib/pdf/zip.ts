export interface ZipEntry {
  fileName: string;
  blob: Blob;
}

const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_END = 0x06054b50;
const UTF8_FLAG = 0x0800;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

/**
 * Build a standards-compliant ZIP using the STORE method (no compression).
 * Images are already compressed by PNG/JPEG, so recompressing them is wasteful.
 */
export async function createStoredZip(entries: readonly ZipEntry[]): Promise<Blob> {
  if (entries.length === 0) throw new Error('There are no images to add to the ZIP file.');
  if (entries.length > 65_535) throw new Error('Too many files for a single ZIP archive.');

  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const fileName = encoder.encode(entry.fileName);
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    if (bytes.byteLength > 0xffffffff || localOffset > 0xffffffff) {
      throw new Error('The ZIP archive exceeds the supported 4 GB limit.');
    }
    const checksum = crc32(bytes);

    const localHeader = new Uint8Array(30 + fileName.length);
    const localView = new DataView(localHeader.buffer);
    write32(localView, 0, ZIP_LOCAL_FILE);
    write16(localView, 4, 20);
    write16(localView, 6, UTF8_FLAG);
    write16(localView, 8, 0);
    write16(localView, 10, 0);
    write16(localView, 12, 0x0021);
    write32(localView, 14, checksum);
    write32(localView, 18, bytes.byteLength);
    write32(localView, 22, bytes.byteLength);
    write16(localView, 26, fileName.length);
    write16(localView, 28, 0);
    localHeader.set(fileName, 30);
    localParts.push(localHeader, bytes);

    const centralHeader = new Uint8Array(46 + fileName.length);
    const centralView = new DataView(centralHeader.buffer);
    write32(centralView, 0, ZIP_CENTRAL_FILE);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, UTF8_FLAG);
    write16(centralView, 10, 0);
    write16(centralView, 12, 0);
    write16(centralView, 14, 0x0021);
    write32(centralView, 16, checksum);
    write32(centralView, 20, bytes.byteLength);
    write32(centralView, 24, bytes.byteLength);
    write16(centralView, 28, fileName.length);
    write16(centralView, 30, 0);
    write16(centralView, 32, 0);
    write16(centralView, 34, 0);
    write16(centralView, 36, 0);
    write32(centralView, 38, 0);
    write32(centralView, 42, localOffset);
    centralHeader.set(fileName, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + bytes.byteLength;
    centralSize += centralHeader.length;
  }

  if (localOffset + centralSize + 22 > 0xffffffff) {
    throw new Error('The ZIP archive exceeds the supported 4 GB limit.');
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, ZIP_END);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, entries.length);
  write16(endView, 10, entries.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, localOffset);
  write16(endView, 20, 0);

  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}
