import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
import { renderTemplate } from '../../template.js';
import { stringify } from '../../text.js';
export const condition: NodeDefinition = {
  type: 'condition',
  label: 'Condition',
  description: 'Route a value to one branch',
  category: 'Logic',
  inputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
  outputs: [
    { name: 'true', label: 'True', dataType: 'any', optional: true },
    { name: 'false', label: 'False', dataType: 'any', optional: true },
  ],
  templateFields: ['left', 'right'],
  configSchema: z.object({
    left: z.string().default('{{input.value}}'),
    operator: z
      .enum(['equals', 'notEquals', 'contains', 'notContains', 'matchesRegex', 'isEmpty', 'isNotEmpty', 'gt', 'lt'])
      .default('equals'),
    right: z.string().default(''),
  }),
  defaultConfig: { left: '{{input.value}}', operator: 'equals', right: '' },
  async execute(ctx) {
    const left = renderTemplate(String(ctx.config.left), ctx);
    const right = renderTemplate(String(ctx.config.right), ctx);
    let result: boolean;
    switch (ctx.config.operator) {
      case 'equals':
        result = left === right;
        break;
      case 'notEquals':
        result = left !== right;
        break;
      case 'contains':
        result = left.includes(right);
        break;
      case 'notContains':
        result = !left.includes(right);
        break;
      case 'matchesRegex':
        result = new RegExp(right).test(left);
        break;
      case 'isEmpty':
        result = !left;
        break;
      case 'isNotEmpty':
        result = !!left;
        break;
      case 'gt':
        result = Number(left) > Number(right);
        break;
      case 'lt':
        result = Number(left) < Number(right);
        break;
      default:
        throw new Error('Unknown condition operator');
    }
    return { [String(result)]: ctx.inputs.value ?? stringify(left) };
  },
};
