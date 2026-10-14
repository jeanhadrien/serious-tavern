import { z } from 'zod';
import { characterSchema, presetInputLabel, reasoningEfforts, type PromptMessage } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { renderPreset } from '../../preset.js';
import { adapters, missingSecretMessage, type ChatResponse } from '../../providers/index.js';
import '../../providers/openai-compatible.js';

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
  // Backstop only: the provider enforces its own idle timeout, so a live stream is not cut at the default 30s.
  timeoutMs: 600_000,
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
    reasoningEffort: z
      .enum(reasoningEfforts)
      .default('off')
      .describe('Ask the model to reason before answering; reasoning streams separately from the reply'),
    reasoningMaxTokens: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Reasoning token budget, for models that support it; counts against max tokens'),
    reasoningExclude: z
      .boolean()
      .default(false)
      .describe('Let the model reason but do not return the reasoning (still billed)'),
    mergeSystemMessages: z
      .boolean()
      .default(false)
      .describe('Merge consecutive unnamed system messages with blank lines'),
    streaming: z
      .boolean()
      .default(true)
      .describe('Stream tokens and reasoning as they are generated; disable to wait for the full response'),
  }),
  defaultConfig: {
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
    presetId: '',
    temperature: 0.7,
    maxTokens: 1024,
    reasoningEffort: 'off',
    reasoningExclude: false,
    mergeSystemMessages: false,
    streaming: true,
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
          label: presetInputLabel(input.key),
          dataType: input.dataType,
        })),
      ],
      outputs: llm.outputs,
    };
  },
  async execute(ctx) {
    const provider = await ctx.resources.providers?.get(String(ctx.config.provider));
    if (!provider) throw new Error(`Unknown LLM provider: ${ctx.config.provider}`);
    const adapter = adapters.get(provider.kind);
    if (!adapter) throw new Error(`Provider "${provider.name}" has unsupported kind: ${provider.kind}`);
    const preset = await ctx.resources.presets.get(String(ctx.config.presetId));
    if (!preset) throw new Error(`Preset ${ctx.config.presetId} not found`);
    // A provider without a secret (a local server) is called without credentials.
    const apiKey = provider.secret ? await ctx.secrets.get(provider.secret) : undefined;
    if (provider.secret && !apiKey) throw new Error(missingSecretMessage(provider.secret));
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
        [
          'topP',
          'frequencyPenalty',
          'presencePenalty',
          'stop',
          'reasoningEffort',
          'reasoningMaxTokens',
          'reasoningExclude',
        ]
          .filter((field) => ctx.config[field] !== undefined)
          .map((field) => [field, ctx.config[field]]),
      ),
    };
    const options = { provider, apiKey, signal: ctx.signal, onWire: ctx.recordWire };
    const delta = (detail: { textDelta?: string; reasoningDelta?: string }) =>
      ctx.emit({ type: 'node:delta', nodeId: ctx.nodeId, detail });
    // Deltas are notifications only; the outcome is the accumulated response returned below.
    const stream = adapter.stream;
    let response: ChatResponse;
    if (ctx.config.streaming !== false && stream != null) {
      response = await stream(request, {
        ...options,
        onToken: (textDelta) => delta({ textDelta }),
        onReasoning: (reasoningDelta) => delta({ reasoningDelta }),
      });
    } else {
      response = await adapter.chat(request, options);
      // A whole reasoning trace reaches the chat like a streamed one: as a single delta.
      if (response.reasoning) delta({ reasoningDelta: response.reasoning });
    }
    return { text: response.text, raw: response.raw };
  },
};
