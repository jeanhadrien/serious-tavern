import { parse, stringify } from 'yaml';
import { providerFieldsSchema, type ProviderFields, type ProviderView } from '@st/shared';
import { classifyDraftChange } from '../draftChange.js';
import type { DiskChange } from '../fileLiveSync.js';

/**
 * What the provider editor edits: the common fields as form values, and the structured fields (`headers`,
 * `extraBody`, `overrides`) as one raw YAML document. Bookkeeping and unknown fields are not part of it; the
 * server keeps unknown fields on update.
 */
export interface ProviderDraft {
  name: string;
  baseUrl: string;
  /** Name of a secret in Settings; empty means no secret (no Authorization header). */
  secret: string;
  /** Wire field for message names; null means names are never sent. */
  messageName: string | null;
  /** Read in this order, first non-empty wins. */
  reasoningFields: string[];
  /** YAML mapping with `headers`, `extraBody` and `overrides`. */
  advanced: string;
}

const ADVANCED_KEYS = ['headers', 'extraBody', 'overrides'] as const;

export function toDraft(provider: ProviderView): ProviderDraft {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    secret: provider.secret ?? '',
    messageName: provider.messageName === undefined ? 'name' : provider.messageName,
    reasoningFields: [...(provider.reasoningFields ?? [])],
    advanced: stringify(
      { headers: provider.headers ?? {}, extraBody: provider.extraBody ?? {}, overrides: provider.overrides ?? [] },
      { lineWidth: 0, indent: 2 },
    ),
  };
}

const sameDraft = (a: ProviderDraft, b: ProviderDraft) => JSON.stringify(a) === JSON.stringify(b);

/** True when the draft differs from what the provider holds. */
export const draftChanged = (draft: ProviderDraft, provider: ProviderView) => !sameDraft(draft, toDraft(provider));

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  baseUrl: 'Base URL',
  secret: 'Secret',
  messageName: 'Message name field',
  reasoningFields: 'Reasoning fields',
};

/** Reads the YAML part; returns the three fields, or the problems as plain-language messages. */
function parseAdvanced(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] } {
  let raw: unknown;
  try {
    raw = text.trim() ? parse(text) : {};
  } catch (error) {
    return { ok: false, errors: [`YAML: ${(error as Error).message}`] };
  }
  raw ??= {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, errors: ['YAML: must be a mapping with headers, extraBody and overrides'] };
  const unknown = Object.keys(raw).filter((key) => !(ADVANCED_KEYS as readonly string[]).includes(key));
  if (unknown.length)
    return {
      ok: false,
      errors: unknown.map((key) => `YAML: unknown key "${key}" (only headers, extraBody and overrides go here)`),
    };
  return { ok: true, value: raw as Record<string, unknown> };
}

/**
 * The request body for a draft, validated like the server does, or the problems found. A blank secret is
 * omitted (the record then has none), and blank reasoning fields are dropped. A YAML key that is missing or
 * empty means "none": it is sent as an empty value, because the server keeps stored fields a body omits.
 */
export function draftToBody(
  draft: ProviderDraft,
  kind: ProviderFields['kind'],
): { ok: true; body: ProviderFields } | { ok: false; errors: string[] } {
  const advanced = parseAdvanced(draft.advanced);
  if (!advanced.ok) return advanced;
  const secret = draft.secret.trim();
  const given = Object.fromEntries(Object.entries(advanced.value).filter(([, value]) => value != null));
  const body = {
    name: draft.name,
    kind,
    baseUrl: draft.baseUrl,
    ...(secret && { secret }),
    messageName: draft.messageName === null ? null : draft.messageName.trim(),
    reasoningFields: draft.reasoningFields.map((field) => field.trim()).filter(Boolean),
    headers: {},
    extraBody: {},
    overrides: [],
    ...given,
  };
  const parsed = providerFieldsSchema.safeParse(body);
  if (parsed.success) return { ok: true, body: parsed.data };
  return { ok: false, errors: parsed.error.issues.map((issue) => `${fieldName(issue.path)}: ${issue.message}`) };
}

/** A form label for form fields, the YAML path for the rest (e.g. `YAML overrides.0.match`). */
function fieldName(path: readonly PropertyKey[]): string {
  const [head, ...rest] = path.map(String);
  const label = head === undefined ? undefined : FIELD_LABELS[head];
  return label ? [label, ...rest].join(' ') : `YAML ${path.map(String).join('.')}`;
}

/** The draft as the server would store it (trimmed, YAML re-serialized), or undefined when it is invalid. */
function normalized(draft: ProviderDraft, provider: ProviderView): ProviderDraft | undefined {
  const result = draftToBody(draft, provider.kind);
  return result.ok ? toDraft({ ...provider, secret: undefined, ...result.body }) : undefined;
}

/** What a fresh provider list means for the open editor (see `classifyDraftChange`). */
export function classifyProviderChange(
  editor: { draft?: ProviderDraft; provider?: ProviderView; deleting?: boolean },
  fresh: readonly ProviderView[],
): DiskChange<ProviderView> {
  return classifyDraftChange({ ...editor, item: editor.provider }, fresh, { toDraft, stored: normalized });
}
