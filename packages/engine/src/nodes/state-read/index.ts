import { z } from 'zod';
import { stateKeyPortType, stateReads, type PortDef, type StateRead } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { locateConfigured, shown, type LocatedKey } from '../state-key.js';

const readOf = (config: Record<string, unknown>): StateRead => {
  const read = config.read ?? 'value';
  if (!stateReads.includes(read as StateRead)) throw new Error(`Unknown read "${String(read)}"`);
  return read as StateRead;
};

/** What the node outputs: the key's value, or facts about it (collections also report their size). */
function outputsFor({ def }: LocatedKey, read: StateRead): PortDef[] {
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
      .describe('The value, or facts about it: written, turns since write, count'),
  }),
  defaultConfig: { definitionId: '', key: '', read: 'value' },
  async resolvePorts(config, resources) {
    const found = await locateConfigured(config, (id) => resources.stateDefinitions?.get(id));
    return { inputs: [], outputs: outputsFor(found, readOf(config)) };
  },
  async execute(ctx) {
    const found = await locateConfigured(ctx.config, (id) => ctx.state.definition(id));
    const view = ctx.state.read(found.definition.id, found.key);
    if (!view) throw new Error(`State definition "${found.definition.name}" has no key "${found.key}"`);
    if (readOf(ctx.config) === 'value') {
      ctx.log(`${found.label} = ${shown(view.value)}`);
      return { value: view.value };
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
