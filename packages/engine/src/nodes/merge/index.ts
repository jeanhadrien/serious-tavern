import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
export const merge: NodeDefinition = {
  type: 'merge', label: 'Merge', description: 'Combine available branches', category: 'Logic',
  inputs: ['a', 'b', 'c', 'd'].map(name => ({ name, label: name.toUpperCase(), dataType: 'any' })),
  outputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
  configSchema: z.object({ mode: z.enum(['object', 'array', 'first-non-empty']).default('object') }),
  defaultConfig: { mode: 'object' },
  async execute({ inputs, config }) {
    const entries = Object.entries(inputs);
    const value = config.mode === 'array' ? entries.map(([, v]) => v) :
      config.mode === 'first-non-empty' ? entries.find(([, v]) => v != null && v !== '')?.[1] ?? null :
        Object.fromEntries(entries);
    return { value };
  }
};
