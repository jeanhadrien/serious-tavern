import { isDeepStrictEqual } from 'node:util';
import { Document, parse, stringify, visit } from 'yaml';
import { presetSchema, type Preset } from '@st/shared';

type Obj = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

// Human-meaningful keys come first, bookkeeping last; unknown passthrough fields sit in between.
const PRESET_FIRST = ['name', 'description', 'inputs', 'entries'];
const PRESET_LAST = ['id', 'createdAt', 'updatedAt', 'source'];
const INPUT_FIRST = ['id', 'key', 'dataType'];
const ENTRY_FIRST = ['id', 'name', 'kind', 'role', 'enabled', 'inputKey', 'placement', 'content'];

function arrange(value: Obj, first: string[], last: string[] = []): Obj {
  const result: Obj = {};
  for (const key of first) if (key in value) result[key] = value[key];
  for (const key of Object.keys(value)) if (!first.includes(key) && !last.includes(key)) result[key] = value[key];
  for (const key of last) if (key in value) result[key] = value[key];
  return result;
}

/** Readable unique label for a slot that depth placements point at. */
function slotLabel(name: unknown, taken: Set<string>): string {
  const base =
    String(name ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{Nd}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'slot';
  let label = base;
  for (let n = 2; taken.has(label); n++) label = `${base}-${n}`;
  taken.add(label);
  return label;
}

/**
 * Serializes a preset to YAML. Ids that carry no meaning (UUIDs, or equal to the position-derived default)
 * are left out; slots targeted by depth placements get a readable label id instead.
 */
export function presetToYaml(preset: Preset): string {
  const plain = JSON.parse(JSON.stringify(preset)) as Obj;
  const entries = (Array.isArray(plain.entries) ? plain.entries : []).filter(isObj);
  const inputs = (Array.isArray(plain.inputs) ? plain.inputs : []).filter(isObj);

  const targets = new Set<unknown>();
  for (const entry of entries) {
    if (isObj(entry.placement) && entry.placement.mode === 'depth') targets.add(entry.placement.entryId);
  }
  const taken = new Set<string>(entries.map((entry) => String(entry.id)));
  for (let position = 1; position <= entries.length; position++) taken.add(`entry-${position}`);
  const renamed = new Map<string, string>();

  entries.forEach((entry, index) => {
    const id = String(entry.id);
    if (UUID.test(id)) {
      if (targets.has(id)) {
        const label = slotLabel(entry.name, taken);
        renamed.set(id, label);
        entry.id = label;
      } else delete entry.id;
    } else if (id === `entry-${index + 1}`) delete entry.id;
  });
  inputs.forEach((input, index) => {
    const id = String(input.id);
    if (UUID.test(id) || id === `input-${index + 1}`) delete input.id;
  });
  for (const entry of entries) {
    const placement = entry.placement;
    if (!isObj(placement)) continue;
    if (placement.mode === 'depth') placement.entryId = renamed.get(String(placement.entryId)) ?? placement.entryId;
    else if (Object.keys(placement).length === 1 && placement.mode === 'ordered') delete entry.placement;
  }

  plain.inputs = inputs.map((input) => arrange(input, INPUT_FIRST));
  plain.entries = entries.map((entry) => arrange(entry, ENTRY_FIRST));
  const arranged = arrange(plain, PRESET_FIRST, PRESET_LAST);
  const text = render(arranged, canBeBlock);
  // Safety net: the output must read back to exactly what was written, else quote every multi-line string.
  if (isDeepStrictEqual(safeParse(text), arranged)) return text;
  const quoted = render(arranged, () => false);
  if (!isDeepStrictEqual(safeParse(quoted), arranged)) throw new Error('Preset cannot be represented as YAML');
  return quoted;
}

const STRINGIFY = { lineWidth: 0, blockQuote: 'literal', indent: 2 } as const;
const safeParse = (text: string): unknown => {
  try {
    return parse(text, { logLevel: 'error' });
  } catch {
    return undefined;
  }
};
// Block scalars cannot carry some content (e.g. whitespace-only lines); those strings get double quotes.
const canBeBlock = (value: string) => safeParse(stringify(value, STRINGIFY)) === value;

function render(value: Obj, block: (text: string) => boolean): string {
  const doc = new Document(value);
  visit(doc, {
    Scalar(_, node) {
      if (typeof node.value === 'string' && node.value.includes('\n') && !block(node.value)) node.type = 'QUOTE_DOUBLE';
    },
  });
  return doc.toString(STRINGIFY);
}

// Assigns position-derived ids to items without one, skipping ids that are already taken.
function fillIds(items: unknown, prefix: string): unknown {
  if (!Array.isArray(items)) return items;
  const used = new Set(items.flatMap((item) => (isObj(item) && typeof item.id === 'string' ? [item.id] : [])));
  return items.map((item, index) => {
    if (!isObj(item) || item.id !== undefined) return item;
    const base = `${prefix}-${index + 1}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return { ...item, id };
  });
}

/** What a hand-written file may omit: ids, `enabled` (defaults to true) and empty `inputs`/`entries`. */
function presetCandidate(raw: unknown): Obj | undefined {
  if (!isObj(raw)) return undefined;
  const entries = fillIds(raw.entries ?? [], 'entry');
  return {
    ...raw,
    inputs: fillIds(raw.inputs ?? [], 'input'),
    entries: Array.isArray(entries)
      ? entries.map((entry) => (isObj(entry) && entry.enabled === undefined ? { ...entry, enabled: true } : entry))
      : entries,
  };
}

export type PresetFileResult =
  | { ok: true; preset: Preset }
  | { ok: false; reason: string; candidate?: Obj; needsStamp?: boolean };

/** Parses and validates file text. Flags a structurally valid file that only lacks id/timestamps. */
export function parsePresetYaml(text: string): PresetFileResult {
  let raw: unknown;
  try {
    raw = parse(text, { logLevel: 'error' });
  } catch (error) {
    return { ok: false, reason: `invalid YAML: ${(error as Error).message}` };
  }
  const candidate = presetCandidate(raw);
  if (!candidate) return { ok: false, reason: 'top level must be a mapping' };
  const parsed = presetSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, preset: parsed.data };
  const stamped = presetSchema.safeParse({
    createdAt: 'x',
    updatedAt: 'x',
    ...Object.fromEntries(Object.entries(candidate).filter(([, value]) => value != null)),
    id: '00000000-0000-4000-8000-000000000000',
  });
  const missing = ['id', 'createdAt', 'updatedAt'].some((key) => candidate[key] == null);
  if (stamped.success && missing) return { ok: false, reason: 'missing id or timestamps', candidate, needsStamp: true };
  const issue = parsed.error.issues[0];
  return { ok: false, reason: `invalid preset: ${issue?.path.join('.') || '(root)'}: ${issue?.message}` };
}
