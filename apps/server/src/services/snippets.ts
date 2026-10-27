import { randomUUID } from 'node:crypto';
import { snippetSchema, snippetTexts, type ApiParsedBody, type Snippet } from '@st/shared';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound } from '../errors.js';
import { publishFileChange } from './change-events.js';

type SnippetBody = ApiParsedBody<'createSnippet'>;

// API writes announce themselves with a fresh scan, like collections (see `services/collections.ts`).
const announce = (context: AppContext) => publishFileChange(context.changes, 'snippets', context.snippets);

// Client bodies may echo a whole record back; identity and timestamps are never client-owned.
const BOOKKEEPING = ['id', 'createdAt', 'updatedAt'];
const writableFields = (body: SnippetBody): SnippetBody =>
  Object.fromEntries(Object.entries(body).filter(([key]) => !BOOKKEEPING.includes(key))) as SnippetBody;

/** The name is the snippet's handle in templates, so two snippets never share one through the API. */
async function requireFreeName({ snippets }: AppContext, name: string, id?: string): Promise<void> {
  if ((await snippets.list()).some((snippet) => snippet.name === name && snippet.id !== id))
    throw new HttpError(409, 'SNIPPET_NAME_TAKEN', `Another snippet is already named "${name}"`);
}

/** The `snippets` namespace a turn or a preview renders with. */
export async function loadSnippetTexts({ snippets }: Pick<AppContext, 'snippets'>): Promise<Record<string, string>> {
  return snippetTexts(await snippets.list());
}

export async function getSnippet({ snippets }: AppContext, id: string): Promise<Snippet> {
  const snippet = await snippets.get(id);
  if (!snippet) throw notFound('Snippet');
  return snippet;
}

export async function createSnippet(context: AppContext, body: SnippetBody): Promise<Snippet> {
  await requireFreeName(context, body.name);
  const date = now();
  const snippet = snippetSchema.parse({ ...writableFields(body), id: randomUUID(), createdAt: date, updatedAt: date });
  await context.snippets.save(snippet);
  await announce(context);
  return getSnippet(context, snippet.id);
}

export async function updateSnippet(context: AppContext, id: string, body: SnippetBody): Promise<Snippet> {
  await requireFreeName(context, body.name, id);
  // Old fields first so unknown ones survive (migrate-on-write); a body without `description` clears it.
  const updated = await context.snippets.update(id, (old) =>
    snippetSchema.parse({
      ...old,
      description: undefined,
      ...writableFields(body),
      id,
      createdAt: old.createdAt,
      updatedAt: now(),
    }),
  );
  if (!updated) throw notFound('Snippet');
  await announce(context);
  return updated;
}

export async function deleteSnippet(context: AppContext, id: string): Promise<void> {
  await getSnippet(context, id);
  await context.snippets.delete(id);
  await announce(context);
}
