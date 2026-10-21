import {
  conversationMessageSchema,
  messageBlocks,
  presetSchema,
  type Character,
  type Persona,
  type Preset,
  type PresetEntry,
  type PromptMessage,
} from '@st/shared';
import { renderContextTemplate } from './template.js';
import { toText } from './text.js';

// The only keys of a prompt message. Stored chat messages carry bookkeeping next to them (id, executionId, status...)
// that must never ride into a prompt.
const MESSAGE_KEYS = [
  'role',
  'content',
  'name',
  'tool_calls',
  'tool_call_id',
  'reasoning',
  'provider_data',
  'provenance',
] as const;

/**
 * The messages of a `messages` slot as prompt messages: each one is checked with the canonical message schema and
 * reduced to its canonical keys (tool calls verbatim). `reasoning`, `provider_data` and `provenance` stay: the LLM
 * node's replay policy decides what is sent.
 */
function renderMessagesSlot(value: unknown, slot: Extract<PresetEntry, { kind: 'slot' }>): PromptMessage[] {
  if (value != null && !Array.isArray(value)) throw new Error(`Input ${slot.inputKey} requires messages`);
  return (value ?? []).map((message: unknown, index: number) => {
    const checked = conversationMessageSchema.safeParse(message);
    if (!checked.success) {
      const issue = checked.error.issues[0]!;
      const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      throw new Error(
        `Input ${slot.inputKey} requires valid messages (message ${index + 1}, ${where}${issue.message})`,
      );
    }
    const source = message as Record<string, unknown>;
    return Object.fromEntries(
      MESSAGE_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
    ) as PromptMessage;
  });
}

const APP_ONLY_KEYS = ['reasoning', 'provider_data', 'provenance'];

// Reasoning, provider data and provenance are for the app and the backend, never for a template: they are dropped
// before any message reaches the template context. Tool calls and tool messages are conversation content and stay.
function forTemplates(message: unknown): unknown {
  if (!message || typeof message !== 'object' || !APP_ONLY_KEYS.some((key) => Object.hasOwn(message, key)))
    return message;
  return Object.fromEntries(Object.entries(message).filter(([key]) => !APP_ONLY_KEYS.includes(key)));
}

/** Where a depth entry goes in a slot: before the `depth`-th last block, as the index of that block's first message. */
function depthPosition(messages: PromptMessage[], depth: number): number {
  const blocks = messageBlocks(messages);
  const starts: number[] = [];
  let start = 0;
  for (const block of blocks) {
    starts.push(start);
    start += block.length;
  }
  starts.push(messages.length);
  return starts[Math.max(0, blocks.length - depth)]!;
}

export function renderPreset(
  preset: Preset,
  options: {
    inputs: Record<string, unknown>;
    templateContext: {
      trigger: { message: string; sessionId: string; turn?: number };
      history?: unknown[];
      character?: Character;
      persona?: Persona;
      settings?: Readonly<Record<string, unknown>>;
      state?: { readonly values: Readonly<Record<string, unknown>> };
    };
  },
): PromptMessage[] {
  const valid = presetSchema.parse(preset);
  const inputByKey = new Map(valid.inputs.map((input) => [input.key, input]));
  // Templates (and text coercion) read this stripped copy; `messages` slots render from the raw `options.inputs`.
  const inputs = Object.fromEntries(
    Object.entries(options.inputs).map(([key, value]) => [
      key,
      inputByKey.get(key)?.dataType === 'messages' && Array.isArray(value) ? value.map(forTemplates) : value,
    ]),
  );
  const history = options.templateContext.history?.map(forTemplates);
  const renderedMessages = new Map<string, PromptMessage>();
  const context = {
    inputs,
    trigger: options.templateContext.trigger,
    history,
    character: options.templateContext.character,
    persona: options.templateContext.persona,
    settings: options.templateContext.settings,
    state: options.templateContext.state,
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
    if (input.dataType === 'text') {
      const content = toText(inputs[input.key]);
      if (content.trim()) result.push({ role: entry.role, content });
      continue;
    }
    const messages = renderMessagesSlot(options.inputs[input.key], entry);
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
      const position = depthPosition(messages, candidate.placement.depth);
      insertions.set(position, [...(insertions.get(position) ?? []), rendered]);
    }
    for (let index = 0; index <= messages.length; index++) {
      result.push(...(insertions.get(index) ?? []));
      if (index < messages.length) result.push(messages[index]!);
    }
  }
  return result;
}
