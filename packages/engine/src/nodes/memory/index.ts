import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
export const memory: NodeDefinition = {
  type: 'memory', label: 'Memory', description: 'Recent conversation history', category: 'Chat',
  inputs: [], outputs: [{ name: 'history', label: 'History', dataType: 'any',
    description: 'Messages or formatted text, depending on the format setting' }],
  configSchema: z.object({ lastN: z.number().int().min(0).default(10), format: z.enum(['text', 'messages']).default('text') }),
  defaultConfig: { lastN: 10, format: 'text' },
  async execute({ history, config }) {
    const recent = config.lastN === 0 ? [] : history.slice(-Number(config.lastN));
    return { history: config.format === 'messages' ? recent : recent.map(m => `${m.role}: ${m.content}`).join('\n') };
  }
};
