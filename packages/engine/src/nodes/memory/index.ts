import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
export const memory: NodeDefinition = {
  type: 'memory',
  label: 'Memory',
  description: 'Recent conversation history, or all of it',
  category: 'Chat',
  inputs: [],
  outputs: [
    {
      name: 'history',
      label: 'History',
      dataType: 'any',
      description: 'Messages or formatted text, depending on the format setting',
    },
  ],
  configSchema: z.object({
    lastN: z
      .number()
      .int()
      .min(0)
      .default(10)
      .describe('How many of the latest messages to include; 0 includes none. Ignored while All is on'),
    format: z.enum(['text', 'messages']).default('text'),
    all: z
      .boolean()
      .default(false)
      .describe(
        'Include the whole history; Last N is then ignored. Use it before a node that drops what is already summarized',
      ),
  }),
  defaultConfig: { lastN: 10, format: 'text', all: false },
  access: () => ({ reads: [{ kind: 'messages' }], writes: [] }),
  async execute({ history, config }) {
    const recent = config.all === true ? history : config.lastN === 0 ? [] : history.slice(-Number(config.lastN));
    return { history: config.format === 'messages' ? recent : recent.map((m) => `${m.role}: ${m.content}`).join('\n') };
  },
};
