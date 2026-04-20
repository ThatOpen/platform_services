import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DECLARATIONS_FILENAME = 'declarations.json';

export type DeclarationType = 'string' | 'number';

export interface Declaration {
  id: string;
  label: string;
  type: DeclarationType;
}

export function declarationsPath(cwd: string): string {
  return join(cwd, DECLARATIONS_FILENAME);
}

/**
 * Reads and validates `declarations.json` from the project root.
 * Throws a user-facing Error when the file is missing or malformed.
 */
export function readDeclarations(cwd: string): Declaration[] {
  const path = declarationsPath(cwd);
  if (!existsSync(path)) {
    throw new Error(
      `${DECLARATIONS_FILENAME} not found in the project root. ` +
        'Every cloud component must declare its runtime parameters in a ' +
        `${DECLARATIONS_FILENAME} file alongside its package.json. ` +
        'See CONTEXT.md for the format.',
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new Error(
      `${DECLARATIONS_FILENAME} is not valid JSON: ${(e as Error).message}`,
    );
  }

  if (!Array.isArray(raw)) {
    throw new Error(`${DECLARATIONS_FILENAME} must contain a JSON array.`);
  }

  const seen = new Set<string>();
  const result: Declaration[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== 'object') {
      throw new Error(`${DECLARATIONS_FILENAME}[${i}] must be an object.`);
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || rec.id.length === 0) {
      throw new Error(
        `${DECLARATIONS_FILENAME}[${i}].id must be a non-empty string.`,
      );
    }
    if (typeof rec.label !== 'string') {
      throw new Error(
        `${DECLARATIONS_FILENAME}[${i}].label must be a string.`,
      );
    }
    if (rec.type !== 'string' && rec.type !== 'number') {
      throw new Error(
        `${DECLARATIONS_FILENAME}[${i}].type must be "string" or "number".`,
      );
    }
    if (seen.has(rec.id)) {
      throw new Error(
        `${DECLARATIONS_FILENAME} has duplicate id "${rec.id}".`,
      );
    }
    seen.add(rec.id);
    result.push({ id: rec.id, label: rec.label, type: rec.type });
  }
  return result;
}

/**
 * Compares a `--params` payload against the declared schema and returns
 * human-readable warnings. Does not throw — callers decide whether the
 * mismatch is fatal (publish) or just noisy (run).
 */
export function validateParams(
  declarations: Declaration[],
  params: Record<string, unknown>,
): string[] {
  const warnings: string[] = [];
  const knownIds = new Set(declarations.map((d) => d.id));

  for (const d of declarations) {
    if (!(d.id in params)) {
      warnings.push(`Missing parameter "${d.id}" (${d.type}).`);
      continue;
    }
    const value = params[d.id];
    if (d.type === 'string' && typeof value !== 'string') {
      warnings.push(
        `Parameter "${d.id}" should be a string, got ${typeof value}.`,
      );
    }
    if (d.type === 'number' && typeof value !== 'number') {
      warnings.push(
        `Parameter "${d.id}" should be a number, got ${typeof value}.`,
      );
    }
  }

  for (const key of Object.keys(params)) {
    if (!knownIds.has(key)) {
      warnings.push(
        `Unknown parameter "${key}" is not declared in ${DECLARATIONS_FILENAME}.`,
      );
    }
  }

  return warnings;
}
