import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
import { renderTemplate } from '../../template.js';
import { stringify } from '../../text.js';
export const chatOutput: NodeDefinition = {
  type: 'chat-output',
  label: 'Chat Output',
  description: 'Reply to the conversation',
  category: 'Chat',
  inputs: [{ name: 'value', label: 'Value', dataType: 'text', required: true }],
  outputs: [{ name: 'reply', label: 'Reply', dataType: 'text' }],
  templateFields: ['template'],
  configSchema: z.object({ template: z.string().default('') }),
  defaultConfig: { template: '' },
  async execute(ctx) {
    return {
      reply: ctx.config.template ? renderTemplate(String(ctx.config.template), ctx) : stringify(ctx.inputs.value),
    };
  },
};
