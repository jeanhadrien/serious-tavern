import { registerProvider, type LlmProvider } from './index.js';

export const openrouter: LlmProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  secretName: 'openrouter',
  async chat(request, { apiKey, signal }) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/serious-tavern',
        'X-Title': 'Serious Tavern',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.name === undefined ? {} : { name: message.name }),
        })),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        ...(request.topP === undefined ? {} : { top_p: request.topP }),
        ...(request.frequencyPenalty === undefined ? {} : { frequency_penalty: request.frequencyPenalty }),
        ...(request.presencePenalty === undefined ? {} : { presence_penalty: request.presencePenalty }),
        ...(request.stop === undefined ? {} : { stop: request.stop }),
      }),
      signal,
    });
    if (!response.ok) {
      const body = await response.text();
      let message = body;
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } | string };
        message = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? body);
      } catch {
        message = body;
      }
      throw new Error(`OpenRouter ${response.status}: ${message.slice(0, 500)}`);
    }
    const raw: unknown = await response.json();
    const text = (raw as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('OpenRouter returned no assistant text');
    return { text, raw, usage: (raw as { usage?: unknown }).usage };
  },
};
registerProvider(openrouter);
