import { describe, expect, it } from 'vitest';
import {
  COMPRESSION_PRESETS,
  getCompressionAttempts,
  MAX_COMPRESS_INPUT_BYTES
} from './compress-pdf';

describe('compression presets', () => {
  it('provides screen, balanced, and print quality settings', () => {
    expect(COMPRESSION_PRESETS.screen.dpi).toBe(96);
    expect(COMPRESSION_PRESETS.balanced.dpi).toBe(144);
    expect(COMPRESSION_PRESETS.print.dpi).toBe(216);
    expect(COMPRESSION_PRESETS.screen.quality).toBeLessThan(COMPRESSION_PRESETS.balanced.quality);
    expect(COMPRESSION_PRESETS.balanced.quality).toBeLessThan(COMPRESSION_PRESETS.print.quality);
  });

  it('uses only the selected preset when no target size is supplied', () => {
    expect(getCompressionAttempts('balanced')).toEqual([
      { dpi: COMPRESSION_PRESETS.balanced.dpi, quality: COMPRESSION_PRESETS.balanced.quality }
    ]);
  });

  it('reduces DPI and JPEG quality progressively for a target-size attempt', () => {
    const attempts = getCompressionAttempts('print', 1 * 1024 * 1024);
    expect(attempts.length).toBeGreaterThan(1);
    expect(attempts.length).toBeLessThanOrEqual(6);
    for (let index = 1; index < attempts.length; index += 1) {
      expect(attempts[index].dpi).toBeLessThanOrEqual(attempts[index - 1].dpi);
      expect(attempts[index].quality).toBeLessThanOrEqual(attempts[index - 1].quality);
    }
  });

  it('rejects targets outside the supported best-effort range', () => {
    expect(() => getCompressionAttempts('screen', 50 * 1024)).toThrow(
      'Choose a target size between 0.1 MB and 500 MB.'
    );
    expect(() => getCompressionAttempts('screen', 501 * 1024 * 1024)).toThrow(
      'Choose a target size between 0.1 MB and 500 MB.'
    );
  });

  it('enforces a documented input file size limit', () => {
    expect(MAX_COMPRESS_INPUT_BYTES).toBe(150 * 1024 * 1024);
  });
});
