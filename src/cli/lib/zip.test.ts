import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { createBundleZip } from './zip';

/**
 * The two faults this file used to have, pinned down:
 * - the bundle was read as UTF-8 text, so any byte sequence that is not
 *   valid UTF-8 became U+FFFD — silent corruption of the published app;
 * - entries were STORED, so a 27 MB bundle travelled as 27 MB.
 */
describe('createBundleZip', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'thatopen-zip-'));

  it('keeps every byte of a bundle that is not valid UTF-8', async () => {
    const d = dir();
    const bundlePath = join(d, 'bundle.js');
    const zipPath = join(d, 'bundle.zip');
    // 0xFF 0xFE and friends: invalid as UTF-8, legal as bytes.
    const original = Buffer.from([
      0x2f, 0x2a, 0xff, 0xfe, 0x80, 0x81, 0x00, 0xc3, 0x28, 0x2a, 0x2f,
    ]);
    writeFileSync(bundlePath, original);

    await createBundleZip(bundlePath, zipPath);

    const zip = await JSZip.loadAsync(readFileSync(zipPath));
    const roundTripped = await zip.file('bundle')!.async('nodebuffer');
    expect(Buffer.compare(roundTripped, original)).toBe(0);
  });

  it('compresses instead of storing', async () => {
    const d = dir();
    const bundlePath = join(d, 'bundle.js');
    const zipPath = join(d, 'bundle.zip');
    // Repetitive input: a STORED zip would be slightly LARGER than the
    // input, a deflated one collapses to a fraction.
    writeFileSync(bundlePath, 'const filler = "aaaaaaaa";\n'.repeat(4_000));

    await createBundleZip(bundlePath, zipPath);

    const inputSize = readFileSync(bundlePath).length;
    const zipSize = readFileSync(zipPath).length;
    expect(zipSize).toBeLessThan(inputSize / 10);
  });

  it('ships declarations.json beside the bundle when given', async () => {
    const d = dir();
    const bundlePath = join(d, 'bundle.js');
    const declarationsPath = join(d, 'declarations.json');
    const zipPath = join(d, 'bundle.zip');
    writeFileSync(bundlePath, 'export {};');
    writeFileSync(declarationsPath, '{"params":[]}');

    await createBundleZip(bundlePath, zipPath, declarationsPath);

    const zip = await JSZip.loadAsync(readFileSync(zipPath));
    expect(await zip.file('declarations.json')!.async('string')).toBe(
      '{"params":[]}',
    );
  });
});
