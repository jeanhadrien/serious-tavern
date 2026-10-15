import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
import { stringify } from '../../text.js';
import { checkType, expectedLabel, extractJson, type JsonExpect, jsonExpectTypes } from './extract.js';

const LOGGED_CHARACTERS = 500;
const valueDescription = (expect: JsonExpect) =>
  expect === 'any' ? 'The parsed JSON value' : `The parsed value (${expectedLabel[expect]})`;

const preview = (text: string) =>
  text.length > LOGGED_CHARACTERS
    ? `${text.slice(0, LOGGED_CHARACTERS)}… (${text.length - LOGGED_CHARACTERS} more characters)`
    : text;

export const parseJson: NodeDefinition = {
  type: 'parse-json',
  label: 'Parse JSON',
  description: 'Read a JSON value out of text, e.g. an LLM answer',
  category: 'Logic',
  inputs: [
    {
      name: 'text',
      label: 'Text',
      dataType: 'text',
      required: true,
      description: 'Text holding one JSON value; code fences and surrounding prose are fine',
    },
  ],
  outputs: [{ name: 'value', label: 'Value', dataType: 'any', description: valueDescription('any') }],
  configSchema: z.object({
    expect: z.enum(jsonExpectTypes).default('any').describe('The type the value must have; anything else fails'),
  }),
  defaultConfig: { expect: 'any' },
  // The config may be unparsed here (editor port requests, edge pruning), so read it defensively.
  async resolvePorts(config) {
    const expect = config.expect ?? 'any';
    if (!jsonExpectTypes.includes(expect as JsonExpect)) throw new Error(`Unknown type "${String(expect)}"`);
    return {
      inputs: parseJson.inputs,
      outputs: [
        {
          name: 'value',
          label: 'Value',
          dataType: expect as JsonExpect,
          description: valueDescription(expect as JsonExpect),
        },
      ],
    };
  },
  async execute(ctx) {
    const expect = ctx.config.expect as JsonExpect;
    const input = ctx.inputs.text;
    // An `any` source hands its value over unconverted: an already parsed value is only type-checked.
    const text = typeof input === 'string' ? input : input === undefined ? '' : undefined;
    try {
      return { value: text === undefined ? checkType(input, expect) : extractJson(text, expect) };
    } catch (error) {
      ctx.log(`Input: ${preview(text ?? stringify(input))}`);
      throw error;
    }
  },
};
