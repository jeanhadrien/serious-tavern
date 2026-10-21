import { describe, expect, it } from 'vitest';
import { promptMessageSchema } from '../preset.js';
import { conversationMessageSchema, exchangeText, type ConversationMessage } from './message.js';
import { toolDefinitionSchema, toolNameSchema } from './tools.js';

const call = { id: 'call_1', type: 'function', function: { name: 'read_state', arguments: '{"key":"a"}' } };

describe('conversationMessageSchema', () => {
  it.each([
    ['a plain user message', { role: 'user', content: 'Hello' }],
    ['a named message', { role: 'assistant', content: 'Hi', name: 'Mira' }],
    ['a system message', { role: 'system', content: '' }],
    ['an assistant message that only calls a tool', { role: 'assistant', content: '', tool_calls: [call] }],
    ['a tool result', { role: 'tool', content: 'ok', tool_call_id: 'call_1' }],
    [
      'an assistant message with the app-only fields',
      {
        role: 'assistant',
        content: 'Done',
        reasoning: 'thinking',
        provider_data: { reasoning_details: [{ type: 'text' }] },
        provenance: { providerId: 'openrouter', model: 'm', nodeId: 'llm-1' },
      },
    ],
  ])('accepts %s', (_name, message) => {
    expect(conversationMessageSchema.safeParse(message).success).toBe(true);
  });

  it.each([
    ['an unknown role', { role: 'developer', content: 'x' }],
    ['content that is not a string', { role: 'user', content: null }],
    ['a tool message without tool_call_id', { role: 'tool', content: 'ok' }],
    ['a tool message with an empty tool_call_id', { role: 'tool', content: 'ok', tool_call_id: '' }],
    ['tool_calls on a user message', { role: 'user', content: 'x', tool_calls: [call] }],
    ['a call without an id', { role: 'assistant', content: '', tool_calls: [{ ...call, id: '' }] }],
    ['a call that is not a function', { role: 'assistant', content: '', tool_calls: [{ ...call, type: 'other' }] }],
    ['a provenance missing the node', { role: 'assistant', content: '', provenance: { providerId: 'p', model: 'm' } }],
  ])('rejects %s', (_name, message) => {
    expect(conversationMessageSchema.safeParse(message).success).toBe(false);
  });

  it('keeps unknown fields of a message and of a call, and the raw arguments text', () => {
    const raw = '{ "key" :  "a" }';
    const message = {
      role: 'assistant',
      content: '',
      extra: 1,
      tool_calls: [{ ...call, thought_signature: 'abc', function: { ...call.function, arguments: raw, more: true } }],
    };
    expect(conversationMessageSchema.parse(message)).toEqual(message);
  });

  it('is the prompt message, so old shapes still parse and keep their meaning', () => {
    expect(promptMessageSchema).toBe(conversationMessageSchema);
    expect(promptMessageSchema.parse({ role: 'user', content: 'Hello', name: 'User' })).toEqual({
      role: 'user',
      content: 'Hello',
      name: 'User',
    });
  });
});

describe('exchangeText', () => {
  const answer: ConversationMessage = { role: 'assistant', content: 'The answer' };
  const toolStep = [
    { role: 'assistant', content: 'Let me look', tool_calls: [call] },
    { role: 'tool', content: 'ok', tool_call_id: 'call_1' },
  ] as ConversationMessage[];

  it.each([
    ['no messages', [], ''],
    ['an answer alone', [answer], 'The answer'],
    ['tool steps then an answer', [...toolStep, answer], 'The answer'],
    ['an exchange cut after a tool result', toolStep, ''],
  ])('gives the final answer of %s', (_name, exchange, expected) => {
    expect(exchangeText(exchange)).toBe(expected);
  });
});

describe('tool definitions', () => {
  it.each(['read_state', 'write-1', 'A', 'x'.repeat(64)])('accepts the tool name %s', (name) => {
    expect(toolNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(['', 'has space', 'dot.name', 'é', 'x'.repeat(65)])('rejects the tool name %j', (name) => {
    expect(toolNameSchema.safeParse(name).success).toBe(false);
  });

  it('takes a function tool with a JSON Schema object', () => {
    const tool = {
      type: 'function',
      function: { name: 'read_state', description: 'Reads', parameters: { type: 'object', properties: {} } },
    };
    expect(toolDefinitionSchema.parse(tool)).toEqual(tool);
    expect(toolDefinitionSchema.safeParse({ ...tool, function: { name: 'bad name', parameters: {} } }).success).toBe(
      false,
    );
    expect(toolDefinitionSchema.safeParse({ ...tool, function: { name: 'ok' } }).success).toBe(false);
    expect(toolDefinitionSchema.safeParse({ ...tool, type: 'custom' }).success).toBe(false);
  });
});
