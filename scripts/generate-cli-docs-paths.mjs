/**
 * Scans docs/cli/*.md, extracts the `description` field from each file's
 * YAML frontmatter, and writes docs/cli/paths.json.
 *
 * Usage:
 *   node scripts/generate-cli-docs-paths.mjs
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CLI_DOCS_DIR = join(ROOT, 'docs', 'cli');

function extractDescription(content) {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const descMatch = fmMatch[1].match(/^description:\s*"([^"]+)"/m);
  return descMatch ? descMatch[1] : null;
}

const files = readdirSync(CLI_DOCS_DIR)
  .filter((f) => f.endsWith('.md'))
  .sort();

const entries = [];

for (const file of files) {
  const filePath = join(CLI_DOCS_DIR, file);
  const content = readFileSync(filePath, 'utf-8');
  const description = extractDescription(content);

  if (!description) {
    console.warn(`⚠  No description found in ${file} — skipping.`);
    continue;
  }

  entries.push({
    path: `docs/cli/${file}`,
    description,
  });

  console.log(`  ✓ ${file}`);
}

const outputPath = join(CLI_DOCS_DIR, 'paths.json');
writeFileSync(outputPath, JSON.stringify(entries, null, 2) + '\n');
console.log(`\n  ✓ paths.json written (${entries.length} entries)`);
