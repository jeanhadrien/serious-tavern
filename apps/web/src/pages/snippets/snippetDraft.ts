import { snippetNameSchema, type Snippet, type SnippetFields } from '@st/shared';
import { classifyDraftChange } from '../draftChange.js';
import type { DiskChange } from '../fileLiveSync.js';

/** What the snippet form edits: plain strings, as typed. */
export interface SnippetDraft {
  name: string;
  description: string;
  text: string;
}

export const toDraft = (snippet: Snippet): SnippetDraft => ({
  name: snippet.name,
  description: snippet.description ?? '',
  text: snippet.text,
});

/** The draft as the server stores it: the name trimmed, a blank description dropped. */
function normalized(draft: SnippetDraft): SnippetDraft {
  return { ...draft, name: draft.name.trim(), description: draft.description.trim() };
}

export const draftChanged = (draft: SnippetDraft, snippet: Snippet) =>
  JSON.stringify(draft) !== JSON.stringify(toDraft(snippet));

/** The write body of a draft, or the problems that keep it from saving. */
export function draftToBody(draft: SnippetDraft): { ok: true; body: SnippetFields } | { ok: false; errors: string[] } {
  const { name, description, text } = normalized(draft);
  const checked = snippetNameSchema.safeParse(name);
  if (!checked.success) return { ok: false, errors: [`Name: ${checked.error.issues[0]?.message}`] };
  return { ok: true, body: { name, ...(description && { description }), text } };
}

/** The first free name of the form `snippet`, `snippet2`, `snippet3`... */
export function newSnippetName(taken: readonly string[]): string {
  for (let index = 1; ; index++) {
    const name = index === 1 ? 'snippet' : `snippet${index}`;
    if (!taken.includes(name)) return name;
  }
}

export function classifySnippetChange(
  editor: { draft?: SnippetDraft; snippet?: Snippet; deleting?: boolean },
  fresh: readonly Snippet[],
): DiskChange<Snippet> {
  return classifyDraftChange({ ...editor, item: editor.snippet }, fresh, { toDraft, stored: normalized });
}
