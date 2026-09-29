import { describe, expect, it } from 'vitest';
import { presetSchema, type Preset, type PresetEntry } from '@st/shared';
import { renderPreset } from './preset.js';

const input = (key: string, dataType: 'messages' | 'text') =>
  ({ id: `${key}-input`, key, dataType });
const slot = (id: string, inputKey: string, enabled = true, role: 'system' | 'user' | 'assistant' = 'user') =>
  ({ id, name: id, kind: 'slot' as const, inputKey, enabled, role });
const message = (id: string, content: string, placement: { mode: 'ordered' } | { mode: 'depth'; entryId: string; depth: number } =
  { mode: 'ordered' }, enabled = true) =>
  ({ id, name: id, kind: 'message' as const, content, role: 'system' as const, enabled, placement });
const preset = (inputs: ReturnType<typeof input>[], entries: PresetEntry[]): Preset =>
  presetSchema.parse({ id: '8f1fe1a9-3480-4e52-834c-f25d90684d71', name: 'Test',
    createdAt: '', updatedAt: '', inputs, entries });
const options = (inputs: Record<string, unknown>) => ({
  inputs, templateContext: { trigger: { message: 'Hello trigger', sessionId: 'session-1' }, history: [] }
});

describe('renderPreset', () => {
  it('preserves list order, expands message/text slots, reuses inputs, and skips disabled entries', () => {
    const definition = preset([input('history', 'messages'), input('prompt', 'text')], [
      message('before', 'Before'),
      slot('history-one', 'history'),
      message('per-slot-injection', 'Only in first slot', { mode: 'depth', entryId: 'history-one', depth: 0 }),
      message('disabled', 'Not shown', { mode: 'ordered' }, false),
      slot('prompt', 'prompt', true, 'assistant'),
      slot('history-two', 'history'),
      slot('disabled-slot', 'prompt', false),
      message('after', 'After')
    ]);
    expect(renderPreset(definition, options({ history: [{ role: 'user', content: 'hi' }],
      prompt: 'Text value' }))).toEqual([
      { role: 'system', content: 'Before' }, { role: 'user', content: 'hi' },
      { role: 'system', content: 'Only in first slot' }, { role: 'assistant', content: 'Text value' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'After' }
    ]);
  });

  it('inserts depth entries at depth zero, before-last, at the start when clamped, and preserves ties', () => {
    const definition = preset([input('history', 'messages')], [
      message('clamped', 'Start', { mode: 'depth', entryId: 'history-slot', depth: 99 }),
      message('before-last', 'Before last', { mode: 'depth', entryId: 'history-slot', depth: 1 }),
      slot('history-slot', 'history'),
      message('end-one', 'After last one', { mode: 'depth', entryId: 'history-slot', depth: 0 }),
      message('end-two', 'After last two', { mode: 'depth', entryId: 'history-slot', depth: 0 })
    ]);
    const messages = [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'last' }];
    expect(renderPreset(definition, options({ history: messages })).map(item => item.content)).toEqual([
      'Start', 'first', 'Before last', 'last', 'After last one', 'After last two'
    ]);
    expect(renderPreset(definition, options({ history: [] })).map(item => item.content))
      .toEqual(['Start', 'Before last', 'After last one', 'After last two']);
  });

  it('renders input and trigger variables, stringifies message inputs as transcripts, and skips empty content', () => {
    const definition = preset([input('history', 'messages'), input('message', 'text'), input('empty', 'text')], [
      message('empty-message', ' \t '),
      message('filled', '{{input.history}}\n{{trigger.message}} {{trigger.sessionId}} {{input.message}}'),
      slot('empty-slot', 'empty'),
      message('disabled', '{{input.message}}', { mode: 'ordered' }, false)
    ]);
    expect(renderPreset(definition, options({
      history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }],
      message: 'Input text', empty: '  '
    }))).toEqual([{
      role: 'system', content: 'user: Hi\nassistant: Hello\nHello trigger session-1 Input text'
    }]);
  });

  it('skips missing and empty text slot values and empty templated fixed messages', () => {
    const definition = preset([input('text', 'text')], [
      message('blank', '  {{input.text}}  '), slot('text-slot', 'text')
    ]);
    expect(renderPreset(definition, options({ text: '' }))).toEqual([]);
    expect(renderPreset(definition, options({}))).toEqual([]);
  });

  it('rejects malformed messages slot values', () => {
    const definition = preset([input('history', 'messages')], [slot('history-slot', 'history')]);
    expect(() => renderPreset(definition, options({ history: 'not messages' })))
      .toThrow('Input history requires messages');
    expect(() => renderPreset(definition, options({ history: [{ role: 'tool', content: 'bad' }] })))
      .toThrow('Input history requires messages with role and content');
  });

  it('rejects invalid schema references rather than rendering them', () => {
    const invalid = preset([input('text', 'text')], [message('unknown', 'Valid initially')]);
    const entry = invalid.entries[0];
    if (entry?.kind === 'message') entry.content = '{{input.missing}}';
    expect(() => renderPreset(invalid, options({}))).toThrow(/Unknown input: missing/);
  });
});
