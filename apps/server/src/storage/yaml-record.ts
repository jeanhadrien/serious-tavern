import { parse } from 'yaml';
import type { z } from 'zod';
import type { ParsedYaml } from './yaml-repository.js';

const STAMPED = ['id', 'createdAt', 'updatedAt'];
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Parses and validates the text of a YAML record file against `schema`. Flags a structurally valid file
 * that only lacks id/timestamps (`needsStamp`), which the repository then stamps in place. Only a missing
 * id is stamped: a present but invalid one (not a UUID) makes the file invalid. `label` names the record
 * kind in the reason (`invalid <label>: <path>: <message>`).
 */
export function parseYamlRecord<T>(text: string, schema: z.ZodType<T>, label: string): ParsedYaml<T> {
  let raw: unknown;
  try {
    raw = parse(text, { logLevel: 'error' });
  } catch (error) {
    return { ok: false, reason: `invalid YAML: ${(error as Error).message}` };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, reason: 'top level must be a mapping' };
  const candidate = raw as Record<string, unknown>;
  const parsed = schema.safeParse(candidate);
  if (parsed.success) return { ok: true, item: parsed.data };
  const stamped = schema.safeParse({
    createdAt: 'x',
    updatedAt: 'x',
    // Only a blank stamped key counts as missing: any other blank value keeps the file invalid (and untouched).
    ...Object.fromEntries(Object.entries(candidate).filter(([key, value]) => value != null || !STAMPED.includes(key))),
    ...(candidate.id == null ? { id: PLACEHOLDER_ID } : {}),
  });
  if (stamped.success && STAMPED.some((key) => candidate[key] == null))
    return { ok: false, reason: 'missing id or timestamps', needsStamp: true };
  // Report the stamped parse's problem: a hand-written file has no id by design, and zod skips object-level
  // refinements (state definitions' key checks) while the id is missing, so the first parse only names the id.
  const issue = (stamped.success ? parsed : stamped).error.issues[0];
  return { ok: false, reason: `invalid ${label}: ${issue?.path.join('.') || '(root)'}: ${issue?.message}` };
}
