import { isPlainObject, keyDefault, type ToolDefinition } from '@st/shared';
import { locateConfigured, type LocatedKey } from '../nodes/state-key.js';
import { planWrite } from '../nodes/state-write/plan.js';
import type { ExecutionContext, StateAccess } from '../types.js';
import { ItemHandles } from './handles.js';
import { uniqueToolName } from './names.js';
import { keySummary, stateOpOf, writeOps, writeParameters } from './state-schemas.js';
import type { EngineTool } from './types.js';

/** A state key the node's settings let the model read or write. */
export type StateTarget = { definitionId: string; key: string };

const READ_TOOL = 'read_state';

const tool = (name: string, description: string, parameters: Record<string, unknown>): ToolDefinition => ({
  type: 'function',
  function: { name, description, parameters },
});

/** A key's value as the model sees it: collection items become `{ handle, text, ...declared fields }`. */
function present({ definition, key, def }: LocatedKey, state: StateAccess, handles: ItemHandles): unknown {
  const value = state.read(definition.id, key)?.value ?? keyDefault(def);
  if (def.type !== 'collection') return value;
  const fields = Object.keys(def.fields ?? {});
  return (Array.isArray(value) ? value : []).filter(isPlainObject).map((item) => ({
    handle: handles.handleFor(String(item.id)),
    text: item.text,
    ...Object.fromEntries(fields.filter((name) => item[name] !== undefined).map((name) => [name, item[name]])),
  }));
}

function readTool(keys: LocatedKey[], handles: ItemHandles): EngineTool {
  const byName = new Map(keys.map((found) => [found.label, found]));
  const names = [...byName.keys()];
  return {
    definition: tool(
      READ_TOOL,
      `Reads story state. Collections are shown as items with a handle (#1, #2, ...) to use with the write tools. Keys:\n${keys.map((found) => `- ${keySummary(found)}`).join('\n')}`,
      {
        type: 'object',
        properties: {
          keys: { type: 'array', items: { type: 'string', enum: names }, description: 'The keys to read.' },
        },
        required: ['keys'],
      },
    ),
    async run(args, ctx) {
      const asked = args.keys;
      if (!Array.isArray(asked) || asked.some((name) => typeof name !== 'string'))
        throw new Error(`"keys" must be a list of key names. Readable keys: ${names.join(', ')}`);
      const state = ctx.pendingState();
      return Object.fromEntries(
        asked.map((name) => {
          const found = byName.get(name);
          if (!found) throw new Error(`"${name}" cannot be read. Readable keys: ${names.join(', ')}`);
          return [name, present(found, state, handles)];
        }),
      );
    },
  };
}

/** The tool's `op`, checked against what the key type offers; scalars default to `set`. */
function operation(found: LocatedKey, given: unknown) {
  const allowed = writeOps(found.def);
  if (given === undefined && !['number', 'collection'].includes(found.def.type)) return stateOpOf('set');
  if (typeof given !== 'string' || !allowed.includes(given))
    throw new Error(`"op" must be one of: ${allowed.join(', ')}`);
  return stateOpOf(given);
}

/** What the write is about (the value, the new item or the item to remove), ready for `planWrite`. */
function writeValue(args: Record<string, unknown>, op: string, handles: ItemHandles): unknown {
  if (op === 'add') {
    const { op: _op, handle: _handle, ...item } = args;
    return item;
  }
  if (op !== 'remove') return args.value;
  if (typeof args.handle !== 'string' || !args.handle.trim())
    throw new Error('"handle" must be the handle of the item to remove, like #1, as read_state shows it');
  const id = handles.idOf(args.handle);
  if (id === undefined) throw new Error(`No item has the handle "${args.handle}". Read the key to see the handles.`);
  return id;
}

/** One write tool. It plans the write with State Write's own rules (`planWrite`), so the two never disagree. */
function writeTool(found: LocatedKey, name: string, handles: ItemHandles): EngineTool {
  const description = `Changes ${keySummary(found)}`;
  return {
    definition: tool(name, description, writeParameters(found)),
    async run(args, ctx) {
      const op = operation(found, args.op);
      const plan = planWrite(found, op, {
        // An increment without an amount adds 1, like State Write.
        connected: args.value !== undefined,
        value: writeValue(args, op, handles),
        current: ctx.pendingState().read(found.definition.id, found.key)?.value,
      });
      for (const line of plan.logs) ctx.log(line);
      // Only a removal of an item that is already gone has no request.
      if (!plan.request) throw new Error(plan.logs[0] ?? 'Nothing was changed');
      ctx.writeState(plan.request);
      return present(found, ctx.pendingState(), handles);
    },
  };
}

/** Finds the configured keys. One that no longer exists is left out with a node log line, not an error. */
async function locateAll(ctx: ExecutionContext, targets: readonly StateTarget[], what: string) {
  const located: LocatedKey[] = [];
  for (const target of targets) {
    try {
      const found = await locateConfigured(target, (id) => ctx.state.definition(id));
      if (!located.some((other) => other.label === found.label)) located.push(found);
    } catch (error) {
      ctx.log(`Left out a ${what} tool: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return located;
}

/**
 * The state tools of an LLM node, generated from its settings: `read_state` for the keys it may read and one
 * `write_<definition>_<key>` for each key it may write. Handles for collection items are per call of this function,
 * so per tool loop.
 */
export async function buildStateTools(
  ctx: ExecutionContext,
  config: { read: readonly StateTarget[]; write: readonly StateTarget[] },
): Promise<EngineTool[]> {
  const handles = new ItemHandles();
  const readable = await locateAll(ctx, config.read, 'read');
  const writable = await locateAll(ctx, config.write, 'write');
  const taken = new Set([READ_TOOL]);
  const writes = writable.map((found) => {
    const name = uniqueToolName(`write_${found.definition.name}_${found.key}`, taken);
    taken.add(name);
    return writeTool(found, name, handles);
  });
  return [...(readable.length > 0 ? [readTool(readable, handles)] : []), ...writes];
}
