import { randomUUID } from 'node:crypto';
import {
  builtInProviders,
  findBuiltInProvider,
  providerSchema,
  type Provider,
  type ProviderFields,
  type ProviderView,
} from '@st/shared';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound } from '../errors.js';
import { publishFileChange } from './change-events.js';

const view = (provider: Provider, builtIn: boolean): ProviderView => ({ ...provider, builtIn });

// API writes announce themselves, so clients update even when no file watcher runs (the watcher, when on,
// announces the same write again, which is harmless: clients just re-fetch).
const announce = (context: AppContext) => publishFileChange(context.changes, 'providers', context.providers);

/** The built-in providers, then the user's. */
export async function listProviders({ providers }: AppContext): Promise<ProviderView[]> {
  return [
    ...builtInProviders.map((provider) => view(provider, true)),
    ...(await providers.list()).map((p) => view(p, false)),
  ];
}

export async function getProvider({ providers }: AppContext, id: string): Promise<ProviderView> {
  const builtIn = findBuiltInProvider(id);
  if (builtIn) return view(builtIn, true);
  const stored = await providers.get(id);
  if (!stored) throw notFound('Provider');
  return view(stored, false);
}

/** Built-in providers are defined in code; writing to one is a client error. */
function assertEditable(id: string): void {
  if (findBuiltInProvider(id))
    throw new HttpError(
      409,
      'PROVIDER_READ_ONLY',
      'Built-in providers are read-only. Duplicate the provider to edit it.',
    );
}

// Client bodies may echo a whole view back; identity, timestamps and the `builtIn` flag are never client-owned.
const BOOKKEEPING = ['id', 'createdAt', 'updatedAt', 'builtIn'];
const writableFields = (body: ProviderFields): ProviderFields =>
  Object.fromEntries(Object.entries(body).filter(([key]) => !BOOKKEEPING.includes(key))) as ProviderFields;

export async function createProvider(context: AppContext, body: ProviderFields): Promise<ProviderView> {
  const date = now();
  const provider = providerSchema.parse({
    ...writableFields(body),
    id: randomUUID(),
    createdAt: date,
    updatedAt: date,
  });
  await context.providers.save(provider);
  await announce(context);
  // Answer with the stored form, like PUT and later GETs.
  return getProvider(context, provider.id);
}

export async function updateProvider(context: AppContext, id: string, body: ProviderFields): Promise<ProviderView> {
  assertEditable(id);
  // Old fields first so unknown ones survive (migrate-on-write); `secret` is cleared unless the body sets it.
  const updated = await context.providers.update(id, (old) =>
    providerSchema.parse({
      ...old,
      secret: undefined,
      ...writableFields(body),
      id,
      createdAt: old.createdAt,
      updatedAt: now(),
    }),
  );
  if (!updated) throw notFound('Provider');
  await announce(context);
  return view(updated, false);
}

/** Workflows whose LLM nodes use the provider, so deleting it can be refused. */
async function workflowsUsing({ workflows }: AppContext, id: string): Promise<string[]> {
  return (await workflows.list())
    .filter((workflow) => workflow.nodes.some((node) => node.type === 'llm' && node.config.provider === id))
    .map((workflow) => workflow.name);
}

export async function deleteProvider(context: AppContext, id: string): Promise<void> {
  assertEditable(id);
  await getProvider(context, id);
  const users = await workflowsUsing(context, id);
  if (users.length) throw new HttpError(409, 'PROVIDER_IN_USE', 'Provider is used by workflows', users);
  await context.providers.delete(id);
  await announce(context);
}

/** Copies any provider, built-in ones included, into a new editable record. */
export async function duplicateProvider(context: AppContext, id: string): Promise<ProviderView> {
  const source = await getProvider(context, id);
  const date = now();
  const copy = providerSchema.parse({
    ...writableFields(source),
    id: randomUUID(),
    name: `${source.name} (copy)`,
    createdAt: date,
    updatedAt: date,
  });
  await context.providers.save(copy);
  await announce(context);
  return getProvider(context, copy.id);
}
