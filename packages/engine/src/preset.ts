import {
  presetSchema,
  type Character,
  type Persona,
  type Preset,
  type PresetEntry,
  type PromptMessage,
} from '@st/shared';
import { renderContextTemplate } from './template.js';
import { toText } from './text.js';

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

// Assistant reasoning is stored for display only, so it is dropped before any message reaches a template.
function withoutReasoning(message: unknown): unknown {
  if (!message || typeof message !== 'object' || !Object.hasOwn(message, 'reasoning')) return message;
  return Object.fromEntries(Object.entries(message).filter(([key]) => key !== 'reasoning'));
}

export function renderPreset(
  preset: Preset,
  options: {
    inputs: Record<string, unknown>;
    templateContext: {
      trigger: { message: string; sessionId: string };
      history?: unknown[];
      character?: Character;
      persona?: Persona;
      settings?: Readonly<Record<string, unknown>>;
    };
  },
): PromptMessage[] {
  const valid = presetSchema.parse(preset);
  const inputByKey = new Map(valid.inputs.map((input) => [input.key, input]));
  const inputs = Object.fromEntries(
    Object.entries(options.inputs).map(([key, value]) => [
      key,
      inputByKey.get(key)?.dataType === 'messages' && Array.isArray(value) ? value.map(withoutReasoning) : value,
    ]),
  );
  const history = options.templateContext.history?.map(withoutReasoning);
  const renderedMessages = new Map<string, PromptMessage>();
  const context = {
    inputs,
    trigger: options.templateContext.trigger,
    history,
    character: options.templateContext.character,
    persona: options.templateContext.persona,
    settings: options.templateContext.settings,
  };
  for (const entry of valid.entries) {
    if (entry.kind !== 'message' || !entry.enabled) continue;
    const content = renderContextTemplate(entry.content, context, 'preset');
    if (!content.trim()) continue;
    // The message name is optional: an empty rendering means "no name", never an empty one.
    const name = entry.name === undefined ? '' : renderContextTemplate(entry.name, context, 'preset').trim();
    renderedMessages.set(entry.id, { role: entry.role, content, ...(name ? { name } : {}) });
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
    const value = inputs[input.key];
    if (input.dataType === 'text') {
      const content = toText(value);
      if (content.trim()) result.push({ role: entry.role, content });
      continue;
    }
    const messages = renderMessagesSlot(value, entry);
    const insertions = new Map<number, PromptMessage[]>();
    for (const candidate of valid.entries) {
      if (
        candidate.kind !== 'message' ||
        !candidate.enabled ||
        candidate.placement.mode !== 'depth' ||
        candidate.placement.entryId !== entry.id
      )
        continue;
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
