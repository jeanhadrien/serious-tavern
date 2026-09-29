import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
import { renderTemplate, stringify } from '../../template.js';
export const llm: NodeDefinition = {
  type: 'llm', label: 'OpenRouter LLM', description: 'Generate a completion with OpenRouter', category: 'AI',
  inputs: [{ name: 'prompt', label: 'Prompt', dataType: 'text' }, { name: 'context', label: 'Context', dataType: 'any' }],
  outputs: [{ name: 'text', label: 'Text', dataType: 'text' }, { name: 'raw', label: 'Raw', dataType: 'object' }],
  templateFields: ['systemPrompt', 'promptTemplate'],
  configSchema: z.object({
    model: z.string().min(1).default('openai/gpt-4o-mini'), systemPrompt: z.string().default(''),
    promptTemplate: z.string().default(''), temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().int().positive().default(1024), includeHistory: z.boolean().default(true)
  }),
  defaultConfig: { model: 'openai/gpt-4o-mini', systemPrompt: '', promptTemplate: '', temperature: 0.7, maxTokens: 1024, includeHistory: true },
  async execute(ctx) {
    const key = await ctx.secrets.get('openrouter');
    if (!key) throw new Error('Missing openrouter secret. Add it in Settings.');
    const prompt = ctx.config.promptTemplate ? renderTemplate(String(ctx.config.promptTemplate), ctx) :
      stringify(ctx.inputs.prompt ?? ctx.trigger.message);
    const messages = [
      ...(ctx.config.systemPrompt ? [{ role: 'system', content: renderTemplate(String(ctx.config.systemPrompt), ctx) }] : []),
      ...(ctx.config.includeHistory ? ctx.history.map(m => ({ role: m.role, content: m.content })) : []),
      { role: 'user', content: ctx.inputs.context == null ? prompt : `${prompt}\n\n${stringify(ctx.inputs.context)}` }
    ];
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ctx.config.model, messages, temperature: ctx.config.temperature, max_tokens: ctx.config.maxTokens }),
      signal: ctx.signal
    });
    if (!response.ok) {
      const body = await response.text();
      let message = body;
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } | string };
        message = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? body;
      } catch { message = body; }
      throw new Error(`OpenRouter ${response.status}: ${message.slice(0, 500)}`);
    }
    const raw: unknown = await response.json();
    const text = (raw as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('OpenRouter returned no assistant text');
    return { text, raw };
  }
};
