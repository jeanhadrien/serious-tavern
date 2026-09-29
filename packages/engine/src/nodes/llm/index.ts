import { z } from 'zod';
import { characterSchema, type PromptMessage } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { renderPreset } from '../../preset.js';
import { providers } from '../../providers/index.js';
import '../../providers/openrouter.js';

export function mergeSystemMessages(messages: readonly PromptMessage[]): PromptMessage[] {
  const result: PromptMessage[] = [];
  for (const message of messages) {
    const previous = result.at(-1);
    if (
      previous?.role === 'system' &&
      previous.name === undefined &&
      message.role === 'system' &&
      message.name === undefined
    ) {
      result[result.length - 1] = { role: 'system', content: `${previous.content}\n\n${message.content}` };
    } else result.push({ ...message });
  }
  return result;
}

export const llm: NodeDefinition = {
  type: 'llm',
  label: 'LLM',
  description: 'Generate a completion using a preset and provider',
  category: 'AI',
  inputs: [{ name: 'character', label: 'Character', dataType: 'character' }],
  outputs: [
    { name: 'text', label: 'Text', dataType: 'text' },
    { name: 'raw', label: 'Raw', dataType: 'object' },
  ],
  configSchema: z.object({
    provider: z.string().min(1).default('openrouter'),
    model: z.string().min(1).default('openai/gpt-4o-mini'),
    presetId: z.string().uuid(),
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().int().positive().default(1024),
    topP: z.number().min(0).max(1).optional(),
    frequencyPenalty: z.number().min(-2).max(2).optional(),
    presencePenalty: z.number().min(-2).max(2).optional(),
    stop: z.array(z.string()).optional(),
    mergeSystemMessages: z
      .boolean()
      .default(false)
      .describe('Merge consecutive unnamed system messages with blank lines'),
  }),
  defaultConfig: {
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
    presetId: '',
    temperature: 0.7,
    maxTokens: 1024,
    mergeSystemMessages: false,
  },
  async resolvePorts(config, resources) {
    const preset = await resources.presets.get(String(config.presetId ?? ''));
    if (!preset) throw new Error(`Preset ${config.presetId || '(none)'} not found`);
    if (preset.inputs.some((input) => input.key === 'character'))
      throw new Error('Preset input "character" conflicts with the LLM character port');
    return {
      inputs: [
        ...llm.inputs,
        ...preset.inputs.map((input) => ({
          name: input.key,
          label: input.label ?? input.key,
          dataType: input.dataType,
          description: input.description,
        })),
      ],
      outputs: llm.outputs,
    };
  },
  async execute(ctx) {
    const provider = providers.get(String(ctx.config.provider));
    if (!provider) throw new Error(`Unknown LLM provider: ${ctx.config.provider}`);
    const preset = await ctx.resources.presets.get(String(ctx.config.presetId));
    if (!preset) throw new Error(`Preset ${ctx.config.presetId} not found`);
    const key = await ctx.secrets.get(provider.secretName);
    if (!key) throw new Error(`Missing ${provider.secretName} secret. Add it in Settings.`);
    const rendered = renderPreset(preset, {
      inputs: ctx.inputs,
      templateContext: {
        trigger: ctx.trigger,
        history: ctx.history,
        character: Object.hasOwn(ctx.inputs, 'character') ? characterSchema.parse(ctx.inputs.character) : ctx.character,
        persona: ctx.persona,
      },
    });
    const messages = ctx.config.mergeSystemMessages === true ? mergeSystemMessages(rendered) : rendered;
    const request = {
      model: String(ctx.config.model),
      messages,
      temperature: Number(ctx.config.temperature),
      maxTokens: Number(ctx.config.maxTokens),
      ...Object.fromEntries(
        ['topP', 'frequencyPenalty', 'presencePenalty', 'stop']
          .filter((field) => ctx.config[field] !== undefined)
          .map((field) => [field, ctx.config[field]]),
      ),
    };
    ctx.recordRequest({ provider: provider.id, ...request });
    const response = await provider.chat(request, { apiKey: key, signal: ctx.signal });
    return { text: response.text, raw: response.raw };
  },
};
