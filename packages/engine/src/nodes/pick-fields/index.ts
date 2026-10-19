import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
import { isPlainObject } from '@st/shared';

/** The field names of the `fields` config: comma separated, trimmed, blanks and repeats dropped. */
export const pickedNames = (fields: string): string[] => [
  ...new Set(
    fields
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  ),
];

export const pickFields: NodeDefinition = {
  type: 'pick-fields',
  label: 'Pick Fields',
  description: 'Keep only some fields of an object, e.g. what a State Write item declares',
  category: 'Logic',
  inputs: [{ name: 'value', label: 'Object', dataType: 'object', required: true, description: 'The object to narrow' }],
  outputs: [
    { name: 'value', label: 'Object', dataType: 'object', description: 'The object with only the listed fields' },
  ],
  configSchema: z.object({
    fields: z
      .string()
      .default('')
      .describe('Field names to keep, separated by commas. A name the object lacks is left out.'),
  }),
  defaultConfig: { fields: '' },
  async execute({ inputs, config, log }) {
    const names = pickedNames(String(config.fields ?? ''));
    if (!names.length) throw new Error('Pick Fields needs at least one field name');
    const value = inputs.value;
    if (!isPlainObject(value)) throw new Error('Pick Fields needs an object as input');
    const missing = names.filter((name) => !Object.hasOwn(value, name));
    if (missing.length) log(`Not in the object: ${missing.join(', ')}`);
    return {
      value: Object.fromEntries(names.filter((name) => Object.hasOwn(value, name)).map((name) => [name, value[name]])),
    };
  },
};
