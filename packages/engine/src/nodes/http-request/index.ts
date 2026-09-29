import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
import { renderTemplate } from '../../template.js';
export const httpRequest: NodeDefinition = {
  type: 'http-request', label: 'HTTP Request', description: 'Fetch a remote endpoint', category: 'Integration',
  inputs: [{ name: 'input', label: 'Input' }],
  outputs: [{ name: 'body', label: 'Body' }, { name: 'status', label: 'Status' }, { name: 'headers', label: 'Headers' }],
  configSchema: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
    url: z.string().min(1), headers: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
    body: z.string().default(''), responseType: z.enum(['json', 'text']).default('json'),
    timeoutMs: z.number().int().min(1).default(15000)
  }),
  defaultConfig: { method: 'GET', url: 'https://example.com', headers: [], body: '', responseType: 'json', timeoutMs: 15000 },
  async execute(ctx) {
    const headers = Object.fromEntries((ctx.config.headers as { key: string; value: string }[])
      .filter(h => h.key).map(h => [renderTemplate(h.key, ctx), renderTemplate(h.value, ctx)]));
    const response = await fetch(renderTemplate(String(ctx.config.url), ctx), {
      method: String(ctx.config.method), headers,
      body: ['GET'].includes(String(ctx.config.method)) ? undefined : renderTemplate(String(ctx.config.body), ctx),
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(Number(ctx.config.timeoutMs))])
    });
    const body: unknown = ctx.config.responseType === 'text' ? await response.text() : await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return { body, status: response.status, headers: Object.fromEntries(response.headers) };
  }
};
