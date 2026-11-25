import { describe, expect, it } from 'vitest';
import { createStoredZip } from './zip';

describe('createStoredZip', () => {
  it('creates a ZIP archive with local, central, and end records', async () => {
    const archive = await createStoredZip([
      { fileName: 'page-1.txt', blob: new Blob(['hello']) },
      { fileName: 'page-2.txt', blob: new Blob(['world']) }
    ]);
    const bytes = new Uint8Array(await archive.arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(archive.type).toBe('application/zip');
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 12, true)).toBe(2);
    expect(new TextDecoder().decode(bytes)).toContain('page-1.txt');
    expect(new TextDecoder().decode(bytes)).toContain('page-2.txt');
  });

  it('rejects an empty archive', async () => {
    await expect(createStoredZip([])).rejects.toThrow('There are no images');
  });
});
