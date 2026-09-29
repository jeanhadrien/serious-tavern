import { canConnect, caseInsensitiveValue, findMacro, presetSchema, type Character, type Persona, type PortDataType, type Preset, type PresetEntry, type PromptMessage } from '@st/shared';
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

function renderMessagesSlot(value: unknown, slot: Extract<PresetEntry, { kind: 'slot' }>): PromptMessage[] {
  if (value != null && !Array.isArray(value)) throw new Error(`Input ${slot.inputKey} requires messages`);
  return (value ?? []).map((message: unknown) => {
    const parsed = message as PromptMessage;
    if (!parsed || !['system', 'user', 'assistant'].includes(parsed.role) || typeof parsed.content !== 'string')
      throw new Error(`Input ${slot.inputKey} requires messages with role and content`);
    if (parsed.name !== undefined && typeof parsed.name !== 'string')
      throw new Error(`Input ${slot.inputKey} requires message names to be strings`);
    return { role: parsed.role, content: parsed.content, ...(parsed.name === undefined ? {} : { name: parsed.name }) };
  });
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
      const macro = findMacro(path);
      if (macro?.source === 'inputs')
        return toText(path.split('.').slice(1).reduce<unknown>(caseInsensitiveValue, options.inputs));
      if (macro?.source === 'history' && !macro.pattern) return toText(options.templateContext.history);
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
    const messages = renderMessagesSlot(value, entry);
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
