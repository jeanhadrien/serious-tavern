import { z } from 'zod';
import { characterSchema } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { renderTemplate } from '../../template.js';
import { stringify } from '../../text.js';
export const chatOutput: NodeDefinition = {
  type: 'chat-output',
  label: 'Chat Output',
  description: 'Reply to the conversation',
  category: 'Chat',
  inputs: [
    { name: 'value', label: 'Value', dataType: 'text', required: true },
    { name: 'character', label: 'Character', dataType: 'character' },
  ],
  outputs: [{ name: 'reply', label: 'Reply', dataType: 'text' }],
  templateFields: ['template'],
  configSchema: z.object({
    template: z.string().default(''),
    name: z.string().default(''),
    order: z.number().default(0),
  }),
  defaultConfig: { template: '', name: '', order: 0 },
  async execute(ctx) {
    if (Object.hasOwn(ctx.inputs, 'character')) characterSchema.parse(ctx.inputs.character);
    return {
      reply: ctx.config.template ? renderTemplate(String(ctx.config.template), ctx) : stringify(ctx.inputs.value),
    };
  },
};
