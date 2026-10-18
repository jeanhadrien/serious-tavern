import { z } from 'zod';
import {
  linkedInChatOrder,
  stateKeyPortType,
  stateReads,
  stateReadsFor,
  type PortDef,
  type StateRead,
} from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { locateConfigured, shown, type LocatedKey } from '../state-key.js';

const readOf = (config: Record<string, unknown>, found: LocatedKey): StateRead => {
  const read = config.read ?? 'value';
  if (!stateReads.includes(read as StateRead)) throw new Error(`Unknown read "${String(read)}"`);
  if (!stateReadsFor(found.def.type).includes(read as StateRead))
    throw new Error(`${found.label} is a ${found.def.type} key; "${String(read)}" needs a collection key`);
  return read as StateRead;
};

/** What the node outputs: the key's value, or facts about it (collections also report their size). */
function outputsFor({ def }: LocatedKey, read: StateRead): PortDef[] {
  if (read === 'linked')
    return [
      {
        name: 'value',
        label: 'Linked items',
        dataType: 'array',
        description:
          'The items that link to chat messages and are still intact, in chat order (not newest first), as at the start of this turn',
      },
    ];
  if (read === 'value')
    return [
      {
        name: 'value',
        label: 'Value',
        dataType: stateKeyPortType(def.type),
        description: 'The value at the start of this turn (the default when nothing was written)',
      },
    ];
  return [
    {
      name: 'written',
      label: 'Written',
      dataType: 'boolean',
      description: 'Whether any turn of this chat wrote the key',
    },
    {
      name: 'turnsSinceWrite',
      label: 'Turns since write',
      dataType: 'number',
      description: 'Turns since the last write; a key never written counts as written before turn 1',
    },
    {
      name: 'writtenAtTurn',
      label: 'Written at turn',
      dataType: 'number',
      optional: true,
      description: 'The turn that last wrote the key; absent when it was never written',
    },
    ...(def.type === 'collection'
      ? [{ name: 'count', label: 'Count', dataType: 'number' as const, description: 'How many items the key holds' }]
      : []),
  ];
}

export const stateRead: NodeDefinition = {
  type: 'state-read',
  label: 'State Read',
  description: "A key of the chat's story state: its value, or when it was last written",
  category: 'State',
  inputs: [],
  outputs: [],
  configSchema: z.object({
    definitionId: z.string().min(1, 'Select a state definition'),
    key: z.string().min(1, 'Select a key'),
    read: z
      .enum(stateReads)
      .default('value')
      .describe(
        'The value, facts about it (written, turns since write, count), or for a list the intact items linked to chat messages in chat order',
      ),
  }),
  defaultConfig: { definitionId: '', key: '', read: 'value' },
  async resolvePorts(config, resources) {
    const found = await locateConfigured(config, (id) => resources.stateDefinitions?.get(id));
    return { inputs: [], outputs: outputsFor(found, readOf(config, found)) };
  },
  async execute(ctx) {
    const found = await locateConfigured(ctx.config, (id) => ctx.state.definition(id));
    const view = ctx.state.read(found.definition.id, found.key);
    if (!view) throw new Error(`State definition "${found.definition.name}" has no key "${found.key}"`);
    const read = readOf(ctx.config, found);
    if (read === 'value') {
      ctx.log(`${found.label} = ${shown(view.value)}`);
      return { value: view.value };
    }
    if (read === 'linked') {
      const items = linkedInChatOrder(view.value);
      const held = Array.isArray(view.value) ? view.value.length : 0;
      ctx.log(`${found.label}: ${items.length} of ${held} items are linked and intact`);
      return { value: items };
    }
    const { written, turnsSinceWrite, writtenAtTurn, count } = view.meta;
    ctx.log(
      `${found.label}: ${written ? `written at turn ${writtenAtTurn}` : 'never written'}, ${turnsSinceWrite} turns since write`,
    );
    return {
      written,
      turnsSinceWrite,
      ...(writtenAtTurn !== null && { writtenAtTurn }),
      ...(found.def.type === 'collection' && { count: count ?? 0 }),
    };
  },
};
