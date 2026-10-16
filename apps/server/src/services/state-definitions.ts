import { randomUUID } from 'node:crypto';
import {
  stateDefinitionSchema,
  type ApiParsedBody,
  type StateDefinition,
  type StateDefinitionInUseDetails,
} from '@st/shared';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound } from '../errors.js';
import { KeyedLock } from '../storage/lock.js';
import { publishFileChange } from './change-events.js';
import { pruneWorkflowsUsingDefinition, sessionsUsing, workflowsUsing } from './state-definition-usage.js';

type DefinitionBody = ApiParsedBody<'createStateDefinition'>;

// API writes announce themselves with a fresh scan, so clients update even when no file watcher runs and a
// still-broken file stays listed (the watcher, when on, announces the same write again, which is harmless).
const announce = (context: AppContext) =>
  publishFileChange(context.changes, 'stateDefinitions', context.stateDefinitions);

// Serializes "is the name free" with the write that takes it, per data directory. Never held while taking a
// session lock (only `sessions.list()`, which doesn't lock, runs inside it).
const nameLock = new KeyedLock();

// Client bodies may echo a whole record back; identity and timestamps are never client-owned.
const BOOKKEEPING = ['id', 'createdAt', 'updatedAt'];
const writableFields = (body: DefinitionBody): DefinitionBody =>
  Object.fromEntries(Object.entries(body).filter(([key]) => !BOOKKEEPING.includes(key))) as DefinitionBody;

export async function listStateDefinitions({ stateDefinitions }: AppContext): Promise<StateDefinition[]> {
  return stateDefinitions.list();
}

export async function getStateDefinition({ stateDefinitions }: AppContext, id: string): Promise<StateDefinition> {
  const definition = await stateDefinitions.get(id);
  if (!definition) throw notFound('State definition');
  return definition;
}

// File stems are lower-cased, so `Scene` and `scene` are one name as far as the files go.
async function requireFreeName({ stateDefinitions }: AppContext, name: string, ownId?: string): Promise<void> {
  const lower = name.toLowerCase();
  const taken = (await stateDefinitions.list()).some(
    (definition) => definition.id !== ownId && definition.name.toLowerCase() === lower,
  );
  if (taken)
    throw new HttpError(409, 'STATE_DEFINITION_NAME_TAKEN', `A state definition named "${name}" already exists.`);
}

// "A, B and 3 more": titles in the message, all of them in `details`.
function listNames(names: readonly string[], shown = 5): string {
  const head = names.slice(0, shown).join(', ');
  return names.length > shown ? `${head} and ${names.length - shown} more` : head;
}

function inUse(message: string, details: StateDefinitionInUseDetails): HttpError {
  return new HttpError(409, 'STATE_DEFINITION_IN_USE', message, details);
}

export function createStateDefinition(context: AppContext, body: DefinitionBody): Promise<StateDefinition> {
  const fields = writableFields(body);
  return nameLock.run(context.stateDefinitions.directory, async () => {
    await requireFreeName(context, fields.name);
    const date = now();
    const definition = stateDefinitionSchema.parse({ ...fields, id: randomUUID(), createdAt: date, updatedAt: date });
    await context.stateDefinitions.save(definition);
    await announce(context);
    // Answer with the stored form, like PUT and later GETs.
    return getStateDefinition(context, definition.id);
  });
}

export function updateStateDefinition(context: AppContext, id: string, body: DefinitionBody): Promise<StateDefinition> {
  const fields = writableFields(body);
  return nameLock.run(context.stateDefinitions.directory, async () => {
    const current = await getStateDefinition(context, id);
    await requireFreeName(context, fields.name, id);
    // Templates bind to the name, so it can't change while a chat holds state under it. Keys and types may
    // change freely: the fold reads stored data against whatever the definition says now (the workflows' State
    // nodes are pruned or reported by validation, below).
    if (fields.name !== current.name) {
      const sessions = await sessionsUsing(context, id);
      if (sessions.length)
        throw inUse(
          `"${current.name}" can't be renamed: story state under that name is stored in these chats: ${listNames(sessions.map((session) => session.title))}. Templates use the name; duplicate the definition to use another one.`,
          { sessions, workflows: [] },
        );
    }
    // Old fields first so unknown top-level ones survive (migrate-on-write); a body without `description` clears it.
    const updated = await context.stateDefinitions.update(id, (old) =>
      stateDefinitionSchema.parse({
        ...old,
        description: undefined,
        ...fields,
        id,
        createdAt: old.createdAt,
        updatedAt: now(),
      }),
    );
    if (!updated) throw notFound('State definition');
    await pruneWorkflowsUsingDefinition(context, id);
    await announce(context);
    return updated;
  });
}

export async function deleteStateDefinition(context: AppContext, id: string): Promise<void> {
  const definition = await getStateDefinition(context, id);
  const [sessions, workflows] = await Promise.all([sessionsUsing(context, id), workflowsUsing(context, id)]);
  if (sessions.length || workflows.length) {
    const reasons = [
      sessions.length && `story state is stored in these chats: ${listNames(sessions.map((session) => session.title))}`,
      workflows.length && `these workflows use it: ${listNames(workflows)}`,
    ].filter(Boolean);
    throw inUse(`"${definition.name}" can't be deleted: ${reasons.join('; ')}.`, { sessions, workflows });
  }
  await context.stateDefinitions.delete(id);
  await announce(context);
}
