import { describe, expect, it } from 'vitest';
import { presetSchema, type Preset } from '@st/shared';
import { renderPreset } from './preset.js';

const input = (key: string, dataType: 'messages' | 'text', enabled = true) =>
  ({ key, name: key, dataType, enabled });
const inputEntry = (id: string, inputKey: string, enabled = true) =>
  ({ id, name: inputKey, kind: 'input' as const, inputKey, enabled, role: 'user' as const });
const message = (id: string, content: string, placement: { mode: 'ordered' } | { mode: 'depth'; inputKey: string; depth: number } = { mode: 'ordered' }) =>
  ({ id, name: id, kind: 'message' as const, content, role: 'system' as const, enabled: true, placement });
const preset = (inputs: ReturnType<typeof input>[], entries: Preset['entries']): Preset =>
  presetSchema.parse({ id: '8f1fe1a9-3480-4e52-834c-f25d90684d71', name: 'Test', createdAt: '', updatedAt: '', inputs, entries });
const options = (inputs: Record<string, unknown>) => ({ inputs, templateContext: {
  trigger: { message: 'Hi', sessionId: 'session-1' }, history: [] }
});
describe('renderPreset', () => {
  it('keeps ordered entries and expands messages and text inputs, skipping disabled entries', () => {
    const definition = preset([input('history', 'messages'), input('prompt', 'text'), input('skip', 'text', false)], [
      message('a', 'A'), inputEntry('history-entry', 'history'), inputEntry('prompt-entry', 'prompt'),
      inputEntry('disabled-entry', 'skip', false), { ...message('off', 'Ignored'), enabled: false }, message('b', 'B')
    ]);
    expect(renderPreset(definition, options({ history: [{ role: 'user', content: 'hello', id: 'metadata' },
      { role: 'assistant', content: 'hi' }], prompt: { a: 1 }, skip: 'disabled' }))).toEqual([
        { role: 'system', content: 'A' }, { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' }, { role: 'user', content: '{\n  "a": 1\n}' },
        { role: 'system', content: 'B' }
      ]);
  });
  it('injects at depth 0, before last, clamps to start and preserves same-depth preset order', () => {
    const definition = preset([input('history', 'messages')], [
      message('start', 'At start', { mode: 'depth', inputKey: 'history', depth: 99 }),
      message('before', 'Before last', { mode: 'depth', inputKey: 'history', depth: 1 }),
      inputEntry('history-entry', 'history'),
      message('end-1', 'After last 1', { mode: 'depth', inputKey: 'history', depth: 0 }),
      message('end-2', 'After last 2', { mode: 'depth', inputKey: 'history', depth: 0 })
    ]);
    expect(renderPreset(definition, options({ history: [{ role: 'user', content: 'first' },
      { role: 'assistant', content: 'last' }] })).map(item => item.content)).toEqual([
        'At start', 'first', 'Before last', 'last', 'After last 1', 'After last 2'
      ]);
    expect(renderPreset(definition, options({ history: [] })).map(item => item.content)).toEqual([
      'At start', 'Before last', 'After last 1', 'After last 2'
    ]);
  });
  it('skips empty templated messages and empty text inputs and renders trigger and input variables', () => {
    const definition = preset([input('empty', 'text'), input('name', 'text')], [
      message('blank', '  {{input.missing}} '),
      message('filled', '{{trigger.message}} {{trigger.sessionId}} {{input.name}}'),
      inputEntry('empty-entry', 'empty')
    ]);
    expect(renderPreset(definition, options({ name: 'Ada', empty: '' }))).toEqual([
      { role: 'system', content: 'Hi session-1 Ada' }
    ]);
  });
  it('rejects malformed messages input values', () => {
    expect(() => renderPreset(preset([input('history', 'messages')], [inputEntry('history-entry', 'history')]),
      options({ history: 'not messages' }))).toThrow('Input history requires messages');
  });
  it('coerces message arrays to text transcripts using connection rules', () => {
    const definition = preset([input('transcript', 'text')], [inputEntry('transcript-entry', 'transcript')]);
    expect(renderPreset(definition, options({ transcript: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }] })))
      .toEqual([{ role: 'user', content: 'user: Hello\nassistant: Hi' }]);
    expect(renderPreset(definition, options({ transcript: [] }))).toEqual([]);
  });
});
