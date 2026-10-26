import { z } from 'zod';
import {
  characterSchema,
  flattenUndeclaredToolBlocks,
  presetInputLabel,
  reasoningEfforts,
  repairToolSequence,
  type PromptMessage,
} from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { renderPreset } from '../../preset.js';
import { adapters, missingSecretMessage } from '../../providers/index.js';
import '../../providers/openai-compatible.js';
import { resolveWireSettings } from '../../providers/wire-settings.js';
import { runToolLoop } from '../../tools/loop.js';
import { buildStateTools } from '../../tools/state-tools.js';
import { modelCaller } from './call.js';
import { applyReplayPolicy } from './replay.js';
import { toolSettingsSchema, writesState } from './tool-settings.js';

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
  // A model that can write state has an effect of its own, so it runs even with no Chat Output downstream.
  sink: writesState,
  inputs: [{ name: 'character', label: 'Character', dataType: 'character' }],
  outputs: [
    { name: 'text', label: 'Text', dataType: 'text' },
    { name: 'raw', label: 'Raw', dataType: 'object' },
    {
      name: 'exchange',
      label: 'Exchange',
      dataType: 'messages',
      description:
        "The messages this run produced: each step's assistant message and its tool results, ending with the answer",
    },
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
    ...toolSettingsSchema.shape,
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
    tools: { read: [], write: [] },
    maxSteps: 5,
    toolChoice: 'auto',
    replayReasoning: 'never',
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
        settings: ctx.settings,
        state: ctx.state,
      },
    });
    const settings = toolSettingsSchema.parse(ctx.config);
    const model = String(ctx.config.model);
    const merged = ctx.config.mergeSystemMessages === true ? mergeSystemMessages(rendered) : rendered;
    const replayed = applyReplayPolicy(merged, settings.replayReasoning);
    // Built once: the same tools declare what stays native in the prompt and run in the loop.
    const tools = await buildStateTools(ctx, settings.tools);
    const { messages: flat, flattened } = flattenUndeclaredToolBlocks(
      replayed,
      tools.map((tool) => tool.definition.function.name),
    );
    if (flattened > 0) ctx.log(`${flattened} tool call(s) of undeclared tools sent as text`);
    const { messages, dropped } = repairToolSequence(flat);
    if (dropped > 0) ctx.log(`Left out ${dropped} tool message(s) or call(s) that had no counterpart in the prompt`);
    // Reasoning the replay setting kept but the provider has no wire field for would vanish without a trace.
    const unsent = messages.filter((message) => message.reasoning).length;
    if (unsent > 0 && resolveWireSettings(provider, model).reasoningReplayField === null)
      ctx.log(
        `Reasoning of ${unsent} message(s) not sent: provider "${provider.name}" has no reasoning replay field for this model`,
      );
    const request = {
      model,
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
    const options = { provider, apiKey, nodeId: ctx.nodeId, signal: ctx.signal, onWire: ctx.recordWire };
    const { exchange, response } = await runToolLoop({
      request,
      call: modelCaller(ctx, adapter, options),
      tools,
      maxSteps: settings.maxSteps,
      toolChoice: settings.toolChoice,
      parallelToolCalls: settings.parallelToolCalls,
      ctx,
    });
    return { text: response.text, raw: response.raw, exchange };
  },
};
