import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';

export const chatSettings: NodeDefinition = {
  type: 'chat-settings',
  label: 'Chat Settings',
  description: "The chat's settings, as declared by this workflow",
  category: 'Chat',
  inputs: [],
  outputs: [
    {
      name: 'settings',
      label: 'Settings',
      dataType: 'object',
      description: 'Every chat setting this workflow declares, by key',
    },
    {
      name: 'value',
      label: 'Value',
      dataType: 'any',
      optional: true,
      description: 'The setting named by Key; absent when Key is empty or not declared',
    },
  ],
  configSchema: z.object({
    key: z.string().default('').describe('Setting to output as Value; leave empty to use Settings only'),
  }),
  defaultConfig: { key: '' },
  async execute(ctx) {
    const settings = { ...ctx.settings };
    const key = String(ctx.config.key ?? '').trim();
    if (!key) return { settings };
    if (!Object.hasOwn(settings, key)) {
      ctx.log(`Chat setting "${key}" is not declared by this workflow; Value is empty.`);
      return { settings };
    }
    return { settings, value: settings[key] };
  },
};
