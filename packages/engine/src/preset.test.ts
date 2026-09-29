import { describe, expect, it } from 'vitest';
import { presetSchema, type Preset } from '@st/shared';
import { renderPreset } from './preset.js';

const slot = (id: string, key: string, dataType: 'messages' | 'text', enabled = true) =>
  ({ id, name: key, kind: 'slot' as const, key, dataType, role: 'user' as const, enabled });
const message = (id: string, content: string, placement: { mode: 'ordered' } | { mode: 'depth'; slot: string; depth: number } = { mode: 'ordered' }) =>
  ({ id, name: id, kind: 'message' as const, content, role: 'system' as const, enabled: true, placement });
const preset = (entries: Preset['entries']): Preset =>
  presetSchema.parse({ id: '8f1fe1a9-3480-4e52-834c-f25d90684d71', name: 'Test', createdAt: '', updatedAt: '', entries });
const options = (slots: Record<string, unknown>) => ({ slots, templateContext: {
  trigger: { message: 'Hi', sessionId: 'session-1' }, history: [] }
});
describe('renderPreset', () => {
  it('keeps ordered entries and expands messages and text slots, skipping disabled entries', () => {
    const input = preset([message('a', 'A'), slot('disabled', 'skip', 'text', false), slot('history', 'history', 'messages'),
      slot('prompt', 'prompt', 'text'), { ...message('off', 'Ignored'), enabled: false }, message('b', 'B')]);
    expect(renderPreset(input, options({ history: [{ role: 'user', content: 'hello', id: 'metadata' },
      { role: 'assistant', content: 'hi' }], prompt: { a: 1 }, skip: 'disabled' }))).toEqual([
        { role: 'system', content: 'A' }, { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' }, { role: 'user', content: '{\n  "a": 1\n}' },
        { role: 'system', content: 'B' }
      ]);
  });
  it('injects at depth 0, before last, clamped to start and keeps same-depth list order', () => {
    const input = preset([
      message('start', 'At start', { mode: 'depth', slot: 'history', depth: 99 }),
      message('before', 'Before last', { mode: 'depth', slot: 'history', depth: 1 }),
      slot('history', 'history', 'messages'),
      message('end-1', 'After last 1', { mode: 'depth', slot: 'history', depth: 0 }),
      message('end-2', 'After last 2', { mode: 'depth', slot: 'history', depth: 0 })
    ]);
    expect(renderPreset(input, options({ history: [{ role: 'user', content: 'first' },
      { role: 'assistant', content: 'last' }] })).map(item => item.content)).toEqual([
        'At start', 'first', 'Before last', 'last', 'After last 1', 'After last 2'
      ]);
    expect(renderPreset(input, options({ history: [] })).map(item => item.content)).toEqual([
      'At start', 'Before last', 'After last 1', 'After last 2'
    ]);
  });
  it('skips empty templated messages and empty text slots and uses trigger and slot variables', () => {
    const input = preset([message('blank', '  {{input.missing}} '),
      message('filled', '{{trigger.message}} {{trigger.sessionId}} {{input.name}}'),
      slot('empty', 'empty', 'text')]);
    expect(renderPreset(input, options({ name: 'Ada', empty: '' }))).toEqual([
      { role: 'system', content: 'Hi session-1 Ada' }
    ]);
  });
  it('rejects malformed messages slot values', () => {
    expect(() => renderPreset(preset([slot('history', 'history', 'messages')]), options({ history: 'not messages' })))
      .toThrow('Slot history requires messages');
  });
  it('coerces message arrays to text transcripts using connection rules', () => {
    expect(renderPreset(preset([slot('transcript', 'transcript', 'text')]),
      options({ transcript: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }] })))
      .toEqual([{ role: 'user', content: 'user: Hello\nassistant: Hi' }]);
    expect(renderPreset(preset([slot('transcript', 'transcript', 'text')]), options({ transcript: [] }))).toEqual([]);
  });
});
