import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Creates a ZIP file with a root-level `bundle` entry and, for cloud
 * components, a `declarations.json` entry next to it describing the
 * runtime parameters the component accepts.
 */
export async function createBundleZip(
  bundleJsPath: string,
  outputZipPath: string,
  declarationsJsonPath?: string,
): Promise<void> {
  // BYTES, not text. Reading with 'utf-8' replaced every invalid sequence
  // with U+FFFD - silent corruption for any bundle that embeds binary data
  // (a base64 worker is fine, raw bytes in a string literal are not).
  const bundleCode = readFileSync(bundleJsPath);
  const zip = new JSZip();
  zip.file('bundle', bundleCode);

  if (declarationsJsonPath) {
    const declarations = readFileSync(declarationsJsonPath, 'utf-8');
    zip.file('declarations.json', declarations);
  }

  // JSZip defaults to STORE: a 27 MB bundle used to travel as 27 MB.
  // Level 6 on purpose - JSZip's level 9 took tens of seconds per megabyte
  // when this was written, for single-digit percent over level 6.
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  writeFileSync(outputZipPath, buffer);
}
