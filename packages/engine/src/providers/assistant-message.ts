import { toolCallSchema, type ConversationMessage, type Provider, type ToolCall } from '@st/shared';

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Merges `source` into `target` the way stream deltas combine: arrays are concatenated, objects merged
 * recursively, anything else replaced. Nulls are ignored. Values are copied, so a stream chunk is never
 * aliased by the result.
 */
export function mergeFields(target: Fields, source: Fields) {
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    const previous = target[key];
    if (Array.isArray(value) && Array.isArray(previous)) previous.push(...structuredClone(value));
    else if (isObject(value) && isObject(previous)) mergeFields(previous, value);
    else target[key] = structuredClone(value);
  }
}

/** The configured replay fields that `source` (a response message or a stream delta) carries. */
export function replayFieldsOf(source: Fields | undefined, fields: readonly string[]): Fields {
  return Object.fromEntries(fields.filter((field) => source?.[field] != null).map((field) => [field, source![field]]));
}

/**
 * Merges a delta's `tool_calls` into the calls collected so far, matched by `index` (by position when a backend
 * leaves it out). `id`, `type` and `function.name` are set once, `function.arguments` is concatenated and any other
 * field is merged. `index` stays in the result: it is the key, and the wire log shows the backend's own shape.
 */
export function mergeToolCalls(calls: Fields[], deltas: unknown[]) {
  deltas.forEach((delta, position) => {
    if (!isObject(delta)) return;
    const index = typeof delta.index === 'number' ? delta.index : position;
    calls[index] ??= {};
    const call = calls[index];
    const { id, type, function: fn, ...rest } = delta;
    if (typeof id === 'string' && id && !call.id) call.id = id;
    if (typeof type === 'string' && type && !call.type) call.type = type;
    mergeFields(call, rest);
    if (!isObject(fn)) return;
    const { name, arguments: args, ...fnRest } = fn;
    call.function ??= {};
    const target = call.function as Fields;
    if (typeof name === 'string' && name && !target.name) target.name = name;
    if (typeof args === 'string') target.arguments = `${(target.arguments as string | undefined) ?? ''}${args}`;
    mergeFields(target, fnRest);
  });
}

/**
 * Turns the calls a response carried (or `mergeToolCalls` collected) into canonical tool calls, keeping every
 * field the backend sent except the stream's `index`. A missing `type` reads as `function` and missing
 * `arguments` as `''`; a call without an id or name is an error naming the provider.
 */
export function toolCallsOf(calls: unknown, providerName: string): ToolCall[] {
  if (!Array.isArray(calls)) return [];
  return calls.filter(isObject).map((streamed) => {
    const call = { ...streamed };
    delete call.index;
    const parsed = toolCallSchema.safeParse({
      type: 'function',
      ...call,
      function: { arguments: '', ...(isObject(call.function) ? call.function : {}) },
    });
    if (!parsed.success) throw new Error(`${providerName} returned a malformed tool call`);
    return parsed.data;
  });
}

type AssistantParts = {
  content: string;
  toolCalls: ToolCall[];
  reasoning?: string;
  providerData: Fields;
  provider: Provider;
  model: string;
  nodeId: string;
};

/** The canonical assistant message of one response; optional parts are left out when empty. */
export function assistantMessage(parts: AssistantParts): ConversationMessage {
  return {
    role: 'assistant',
    content: parts.content,
    ...(parts.toolCalls.length ? { tool_calls: parts.toolCalls } : {}),
    ...(parts.reasoning ? { reasoning: parts.reasoning } : {}),
    ...(Object.keys(parts.providerData).length ? { provider_data: parts.providerData } : {}),
    provenance: { providerId: parts.provider.id, model: parts.model, nodeId: parts.nodeId },
  };
}
