import { canConnect, presetSchema, type Preset, type PromptMessage } from '@st/shared';
import { renderTemplate } from './template.js';

function toText(value: unknown, dataType: 'messages' | 'text'): string {
  if (value == null) return '';
  const messages = Array.isArray(value) && value.every(item => item && typeof item === 'object' &&
    typeof item.role === 'string' && typeof item.content === 'string');
  const source = messages ? 'messages' : typeof value === 'object' ? 'object' : typeof value === 'boolean' ?
    'boolean' : typeof value === 'number' ? 'number' : 'text';
  const compatibility = canConnect(source, 'text');
  if (!compatibility.ok) throw new Error(compatibility.reason);
  if (compatibility.coerce === 'messages-to-text') return (value as PromptMessage[])
    .map(message => `${message.role}: ${message.content}`).join('\n');
  if (dataType === 'messages' && Array.isArray(value))
    throw new Error('Messages input requires messages with role and content');
  return typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

export function renderPreset(preset: Preset, options: {
  inputs: Record<string, unknown>;
  templateContext: { trigger: { message: string; sessionId: string }; history?: unknown[] };
}): PromptMessage[] {
  const valid = presetSchema.parse(preset);
  const result: PromptMessage[] = [];
  const activeInputs = new Map(valid.inputs.filter(input => input.enabled).map(input => [input.key, input]));
  const injections = new Map<string, { depth: number; message: PromptMessage }[]>();
  const renderMessage = (entry: Extract<Preset['entries'][number], { kind: 'message' }>) => {
    const content = renderTemplate(entry.content, {
      inputs: options.inputs, trigger: options.templateContext.trigger,
      history: (options.templateContext.history ?? []) as never[]
    });
    return content.trim() ? { role: entry.role, content } : undefined;
  };
  for (const entry of valid.entries) {
    if (!entry.enabled || entry.kind !== 'message' || entry.placement.mode !== 'depth') continue;
    const message = renderMessage(entry);
    if (!message) continue;
    const list = injections.get(entry.placement.inputKey) ?? [];
    list.push({ depth: entry.placement.depth, message });
    injections.set(entry.placement.inputKey, list);
  }
  for (const entry of valid.entries) {
    if (!entry.enabled) continue;
    if (entry.kind === 'message') {
      if (entry.placement.mode === 'ordered') {
        const message = renderMessage(entry);
        if (message) result.push(message);
      }
      continue;
    }
    const input = activeInputs.get(entry.inputKey)!;
    const value = options.inputs[entry.inputKey];
    if (input.dataType === 'text') {
      const text = toText(value, input.dataType);
      if (text.trim()) result.push({ role: entry.role, content: text });
      continue;
    }
    if (value != null && !Array.isArray(value)) throw new Error(`Input ${input.key} requires messages`);
    const messages: PromptMessage[] = (value ?? []).map((message: unknown) => {
      const parsed = message as PromptMessage;
      if (!parsed || !['system', 'user', 'assistant'].includes(parsed.role) || typeof parsed.content !== 'string')
        throw new Error(`Input ${input.key} requires messages with role and content`);
      return { role: parsed.role, content: parsed.content };
    });
    const buckets = new Map<number, PromptMessage[]>();
    for (const injection of injections.get(input.key) ?? []) {
      const position = Math.max(0, messages.length - injection.depth);
      buckets.set(position, [...(buckets.get(position) ?? []), injection.message]);
    }
    for (let index = 0; index <= messages.length; index++) {
      result.push(...(buckets.get(index) ?? []));
      if (index < messages.length) result.push(messages[index]!);
    }
  }
  return result;
}
