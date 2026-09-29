import { canConnect, presetSchema, type Preset, type PromptMessage } from '@st/shared';
import { renderTemplate } from './template.js';

function slotText(value: unknown): string {
  if (value == null) return '';
  const messages = Array.isArray(value) && value.every(item => item && typeof item === 'object' &&
    typeof item.role === 'string' && typeof item.content === 'string');
  const source = messages ? 'messages' : typeof value === 'object' ? 'object' : typeof value === 'boolean' ?
    'boolean' : typeof value === 'number' ? 'number' : 'text';
  const compatibility = canConnect(source, 'text');
  if (!compatibility.ok) throw new Error(compatibility.reason);
  if (compatibility.coerce === 'messages-to-text') return (value as PromptMessage[])
    .map(message => `${message.role}: ${message.content}`).join('\n');
  return typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

export function renderPreset(preset: Preset, options: {
  slots: Record<string, unknown>;
  templateContext: { trigger: { message: string; sessionId: string }; history?: unknown[] };
}): PromptMessage[] {
  const valid = presetSchema.parse(preset);
  const result: PromptMessage[] = [];
  const injections = new Map<string, { depth: number; message: PromptMessage }[]>();
  for (const entry of valid.entries) {
    if (!entry.enabled || entry.kind !== 'message') continue;
    const content = renderTemplate(entry.content, {
      inputs: options.slots, trigger: options.templateContext.trigger,
      history: (options.templateContext.history ?? []) as never[]
    });
    if (!content.trim()) continue;
    const message = { role: entry.role, content };
    if (entry.placement.mode === 'ordered') continue;
    const list = injections.get(entry.placement.slot) ?? [];
    list.push({ depth: entry.placement.depth, message });
    injections.set(entry.placement.slot, list);
  }
  for (const entry of valid.entries) {
    if (!entry.enabled) continue;
    if (entry.kind === 'message') {
      if (entry.placement.mode === 'ordered') {
        const content = renderTemplate(entry.content, {
          inputs: options.slots, trigger: options.templateContext.trigger,
          history: (options.templateContext.history ?? []) as never[]
        });
        if (content.trim()) result.push({ role: entry.role, content });
      }
      continue;
    }
    if (entry.dataType === 'text') {
      const text = slotText(options.slots[entry.key]);
      if (text.trim()) result.push({ role: entry.role, content: text });
      continue;
    }
    const value = options.slots[entry.key];
    if (value != null && !Array.isArray(value)) throw new Error(`Slot ${entry.key} requires messages`);
    const messages: PromptMessage[] = (value ?? []).map((message: unknown) => {
      const parsed = message as PromptMessage;
      if (!parsed || !['system', 'user', 'assistant'].includes(parsed.role) || typeof parsed.content !== 'string')
        throw new Error(`Slot ${entry.key} requires messages with role and content`);
      return { role: parsed.role, content: parsed.content };
    });
    const buckets = new Map<number, PromptMessage[]>();
    for (const injection of injections.get(entry.key) ?? []) {
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
