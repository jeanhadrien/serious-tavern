import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
import { locateKey } from '../state-key.js';
import { planWrite } from './plan.js';
import { checkOp, writePorts } from './ports.js';

const ops = ['set', 'increment', 'add', 'remove', 'delete'] as const;

export const stateWrite: NodeDefinition = {
  type: 'state-write',
  label: 'State Write',
  description: "Store a value in the chat's story state; it applies when this turn's reply stays in the chat",
  category: 'State',
  // Like Chat Output, it runs every turn once its inputs are ready, whether or not a reply depends on it.
  sink: true,
  inputs: [],
  outputs: [],
  configSchema: z.object({
    definitionId: z.string().min(1, 'Select a state definition'),
    key: z.string().min(1, 'Select a key'),
    op: z.enum(ops).default('set').describe('What to do; the choices depend on the key type'),
  }),
  defaultConfig: { definitionId: '', key: '', op: 'set' },
  async resolvePorts(config, resources) {
    const id = typeof config.definitionId === 'string' ? config.definitionId : '';
    const found = locateKey(id ? await resources.stateDefinitions?.get(id) : undefined, id, config.key);
    return writePorts(found.def, checkOp(found.def, String(config.op ?? 'set')));
  },
  async execute(ctx) {
    const id = String(ctx.config.definitionId);
    const found = locateKey(ctx.state.definition(id), id, ctx.config.key);
    const op = checkOp(found.def, String(ctx.config.op));
    // The start-of-turn value: reads never see this run's writes, however many nodes wrote the key.
    const current = ctx.state.read(found.definition.id, found.key)?.value;
    const plan = planWrite(found, op, {
      connected: Object.hasOwn(ctx.inputs, 'value'),
      value: ctx.inputs.value,
      current,
    });
    for (const line of plan.logs) ctx.log(line);
    if (!plan.request) return {};
    const { item } = ctx.writeState(plan.request);
    return { value: plan.request.op === 'add' ? item : plan.output };
  },
};
