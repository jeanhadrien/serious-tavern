import { collectionWriteSchema, type Collection, type CollectionEntry, type CollectionFields } from '@st/shared';
import type { DiskChange } from '../fileLiveSync.js';
import { classifyDraftChange } from '../draftChange.js';

export const LEVELS = ['1', '2', '3', '4', '5'] as const;

/**
 * One entry as the editor edits it: lists and numbers stay text while typing and are converted on save.
 * Unknown fields travel in `rest` and are sent back unchanged.
 */
export interface EntryDraft {
  text: string;
  title: string;
  /** Comma-separated. */
  keywords: string;
  /** Comma-separated. */
  tags: string;
  /** '' means no level. */
  level: '' | (typeof LEVELS)[number];
  /** '' means the default (1). */
  weight: string;
  enabled: boolean;
  rest: Record<string, unknown>;
  /** The stored lists, kept as they are while their text is unchanged (a stored keyword may hold a comma). */
  original: { keywords?: string[]; tags?: string[] };
}

export interface CollectionDraft {
  name: string;
  description: string;
  entries: EntryDraft[];
}

const KNOWN = ['text', 'title', 'keywords', 'tags', 'level', 'weight', 'enabled'];

const joinList = (items?: readonly string[]) => (items ?? []).join(', ');

/** A comma-separated list as stored: the original list while the text is unchanged, else trimmed items. */
export function listFromText(text: string, original?: string[]): string[] | undefined {
  if (original && text === joinList(original)) return original;
  const items = text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

export function toEntryDraft(entry: CollectionEntry): EntryDraft {
  const rest = Object.fromEntries(Object.entries(entry).filter(([key]) => !KNOWN.includes(key)));
  return {
    text: entry.text,
    title: entry.title ?? '',
    keywords: joinList(entry.keywords),
    tags: joinList(entry.tags),
    level: entry.level === undefined ? '' : (String(entry.level) as EntryDraft['level']),
    weight: String(entry.weight ?? 1),
    enabled: entry.enabled !== false,
    rest,
    original: { keywords: entry.keywords, tags: entry.tags },
  };
}

export const toDraft = (collection: Collection): CollectionDraft => ({
  name: collection.name,
  description: collection.description ?? '',
  entries: collection.entries.map(toEntryDraft),
});

export const newEntry = (): EntryDraft => ({
  text: '',
  title: '',
  keywords: '',
  tags: '',
  level: '',
  weight: '1',
  enabled: true,
  rest: {},
  original: {},
});

/** A one-line label for an entry: its title, else the first line of its text. */
export function entryPreview(entry: Pick<EntryDraft, 'title' | 'text'>): string {
  const label =
    entry.title.trim() ||
    entry.text
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ||
    '';
  if (!label) return '(empty)';
  return label.length > 80 ? `${label.slice(0, 79)}…` : label;
}

function entryBody(entry: EntryDraft, position: number, errors: string[]): Record<string, unknown> {
  const title = entry.title.trim();
  const keywords = listFromText(entry.keywords, entry.original.keywords);
  const tags = listFromText(entry.tags, entry.original.tags);
  const weightText = entry.weight.trim();
  const weight = Number(weightText);
  if (weightText && !(Number.isFinite(weight) && weight >= 0))
    errors.push(`Entry ${position}: weight must be a number of 0 or more`);
  return {
    ...entry.rest,
    text: entry.text,
    ...(title && { title }),
    ...(keywords && { keywords }),
    ...(tags && { tags }),
    ...(entry.level && { level: Number(entry.level) }),
    ...(weightText && { weight }),
    enabled: entry.enabled,
  };
}

/** A field name for a schema problem: `Name`, `Entry 3 level`... */
function fieldName(path: readonly PropertyKey[]): string {
  const [head, index, field] = path.map(String);
  if (head === 'entries' && index !== undefined) return [`Entry ${Number(index) + 1}`, field].filter(Boolean).join(' ');
  return head ? head.charAt(0).toUpperCase() + head.slice(1) : 'Collection';
}

/** The request body for a draft, validated like the server does, or the problems found. */
export function draftToBody(
  draft: CollectionDraft,
): { ok: true; body: CollectionFields } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const description = draft.description.trim() ? draft.description : undefined;
  const body = {
    // Trimmed like the server stores it, so the editor's own save is recognised when it comes back from disk.
    name: draft.name.trim(),
    ...(description !== undefined && { description }),
    entries: draft.entries.map((entry, index) => entryBody(entry, index + 1, errors)),
  };
  if (errors.length) return { ok: false, errors };
  const parsed = collectionWriteSchema.safeParse(body);
  // The body as built (not the parsed copy), so omitted defaults stay omitted; it passed the same schema.
  if (parsed.success) return { ok: true, body: body as CollectionFields };
  const describe = (issue: (typeof parsed.error.issues)[number]) => {
    const field = fieldName(issue.path);
    return issue.message.startsWith(field) ? issue.message : `${field}: ${issue.message}`;
  };
  return { ok: false, errors: parsed.error.issues.map(describe) };
}

const sameDraft = (a: CollectionDraft, b: CollectionDraft) => JSON.stringify(a) === JSON.stringify(b);

/** The draft as the server would store it, or undefined when it is invalid. */
function normalized(draft: CollectionDraft, collection: Collection): CollectionDraft | undefined {
  const result = draftToBody(draft);
  if (!result.ok) return undefined;
  const entries = (result.body.entries ?? []).map((entry) => ({ weight: 1, enabled: true, ...entry }));
  return toDraft({ ...collection, description: undefined, ...result.body, entries });
}

/**
 * The stored collection normalized like a draft, so a hand-written ` title ` or `description: ''` is not a change.
 * It depends on the collection only: an editor computes it once per load, not per keystroke.
 */
export const storedForm = (collection: Collection) => normalized(toDraft(collection), collection);

/** True when saving the draft would change the collection. */
export function draftChanged(
  draft: CollectionDraft,
  collection: Collection,
  stored: CollectionDraft | undefined = storedForm(collection),
): boolean {
  const saved = normalized(draft, collection);
  return !saved || !stored || !sameDraft(saved, stored);
}

/** What a fresh read of the open collection means for the editor (see `classifyDraftChange`). */
export function classifyCollectionChange(
  editor: { draft?: CollectionDraft; collection?: Collection; deleting?: boolean },
  fresh: readonly Collection[],
): DiskChange<Collection> {
  // Dirty is what saving would change: a hand-written ` title ` or an added trailing space is not an edit.
  return classifyDraftChange({ ...editor, item: editor.collection }, fresh, {
    toDraft,
    stored: normalized,
    dirty: (draft, collection) => draftChanged(draft, collection),
  });
}
