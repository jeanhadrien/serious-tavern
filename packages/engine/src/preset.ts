import { canConnect, presetSchema, type Character, type Persona, type PortDataType, type Preset, type PresetEntry, type PromptMessage } from '@st/shared';
import { renderContextTemplate } from './template.js';

function sourceType(value: unknown): PortDataType {
  if (Array.isArray(value) && value.every(item => item && typeof item === 'object' &&
    typeof item.role === 'string' && typeof item.content === 'string')) return 'messages';
  if (value === null || value === undefined) return 'text';
  if (typeof value === 'object') return Array.isArray(value) ? 'array' : 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'text';
}

function toText(value: unknown): string {
  if (value == null) return '';
  const compatibility = canConnect(sourceType(value), 'text');
  if (!compatibility.ok) throw new Error(compatibility.reason);
  if (compatibility.coerce === 'messages-to-text')
    return (value as PromptMessage[]).map(message => `${message.role}: ${message.content}`).join('\n');
  return typeof value === 'string' ? value :
    typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

export function renderPreset(preset: Preset, options: {
  inputs: Record<string, unknown>;
  templateContext: { trigger: { message: string; sessionId: string }; history?: unknown[];
    character?: Character; persona?: Persona };
}): PromptMessage[] {
  const valid = presetSchema.parse(preset);
  const inputByKey = new Map(valid.inputs.map(input => [input.key, input]));
  const renderedMessages = new Map<string, PromptMessage>();
  for (const entry of valid.entries) {
    if (entry.kind !== 'message' || !entry.enabled) continue;
    const content = renderContextTemplate(entry.content, {
      inputs: options.inputs, trigger: options.templateContext.trigger, history: options.templateContext.history,
      character: options.templateContext.character, persona: options.templateContext.persona
    }, path => {
      if (path.startsWith('input.')) return toText(options.inputs[path.slice('input.'.length)]);
      if (path === 'trigger.message') return options.templateContext.trigger.message;
      if (path === 'trigger.sessionId') return options.templateContext.trigger.sessionId;
      if (path === 'history') return toText(options.templateContext.history);
      return undefined;
    });
    if (content.trim()) renderedMessages.set(entry.id, { role: entry.role, content });
  }

  const result: PromptMessage[] = [];
  for (const entry of valid.entries) {
    if (!entry.enabled) continue;
    if (entry.kind === 'message') {
      if (entry.placement.mode === 'ordered') {
        const message = renderedMessages.get(entry.id);
        if (message) result.push(message);
      }
      continue;
    }

    const input = inputByKey.get(entry.inputKey)!;
    const value = options.inputs[input.key];
    if (input.dataType === 'text') {
      const content = toText(value);
      if (content.trim()) result.push({ role: entry.role, content });
      continue;
    }
    if (value != null && !Array.isArray(value)) throw new Error(`Input ${input.key} requires messages`);
    const messages: PromptMessage[] = (value ?? []).map((message: unknown) => {
      const parsed = message as PromptMessage;
      if (!parsed || !['system', 'user', 'assistant'].includes(parsed.role) || typeof parsed.content !== 'string')
        throw new Error(`Input ${input.key} requires messages with role and content`);
      return { role: parsed.role, content: parsed.content };
    });
    const insertions = new Map<number, PromptMessage[]>();
    for (const candidate of valid.entries) {
      if (candidate.kind !== 'message' || !candidate.enabled || candidate.placement.mode !== 'depth' ||
        candidate.placement.entryId !== entry.id) continue;
      const rendered = renderedMessages.get(candidate.id);
      if (!rendered) continue;
      const position = Math.max(0, messages.length - candidate.placement.depth);
      insertions.set(position, [...(insertions.get(position) ?? []), rendered]);
    }
    for (let index = 0; index <= messages.length; index++) {
      result.push(...(insertions.get(index) ?? []));
      if (index < messages.length) result.push(messages[index]!);
    }
  }
  return result;
}
