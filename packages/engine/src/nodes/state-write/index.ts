import { z } from 'zod';
import { stateNodeOps } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { locateConfigured } from '../state-key.js';
import { planWrite } from './plan.js';
import { checkOp, fixedValue, writePorts } from './ports.js';

export const stateWrite: NodeDefinition = {
  type: 'state-write',
  label: 'State Write',
  description: "Store a value in the chat's story state; it applies when this turn's reply stays in the chat",
  category: 'State',
  // Like Chat Output, it runs every turn once its inputs are ready, whether or not a reply depends on it.
  // The optional `when` input (every operation) lets a branch decide whether the write runs at all.
  sink: true,
  inputs: [],
  outputs: [],
  configSchema: z.object({
    definitionId: z.string().min(1, 'Select a state definition'),
    key: z.string().min(1, 'Select a key'),
    op: z.enum(stateNodeOps).default('set').describe('What to do; the choices depend on the key type'),
    // JSON data like any config, so it keeps its type: 5, true, "tense" or {"text": "a storm"}.
    value: z
      .unknown()
      .optional()
      .describe(
        'A fixed value to store when nothing is connected to Value (a connected one wins). It has to fit the key, like a connected one.',
      ),
  }),
  defaultConfig: { definitionId: '', key: '', op: 'set' },
  async resolvePorts(config, resources) {
    const found = await locateConfigured(config, (id) => resources.stateDefinitions?.get(id));
    return writePorts(found.def, checkOp(found.def, String(config.op ?? 'set')), fixedValue(config) !== undefined);
  },
  async execute(ctx) {
    const found = await locateConfigured(ctx.config, (id) => ctx.state.definition(id));
    const op = checkOp(found.def, String(ctx.config.op));
    // The start-of-turn value: reads never see this run's writes, however many nodes wrote the key.
    const current = ctx.state.read(found.definition.id, found.key)?.value;
    // A connected value wins; otherwise the node's fixed one stands in for it, checked the same way.
    const connected = Object.hasOwn(ctx.inputs, 'value');
    const fixed = fixedValue(ctx.config);
    const plan = planWrite(found, op, {
      connected: connected || fixed !== undefined,
      value: connected ? ctx.inputs.value : fixed,
      current,
    });
    for (const line of plan.logs) ctx.log(line);
    if (!plan.request) return {};
    const { item } = ctx.writeState(plan.request);
    return { value: plan.request.op === 'add' ? item : plan.output };
  },
};
