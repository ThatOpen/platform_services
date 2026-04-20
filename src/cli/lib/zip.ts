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
  const bundleCode = readFileSync(bundleJsPath, 'utf-8');
  const zip = new JSZip();
  zip.file('bundle', bundleCode);

  if (declarationsJsonPath) {
    const declarations = readFileSync(declarationsJsonPath, 'utf-8');
    zip.file('declarations.json', declarations);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(outputZipPath, buffer);
}
