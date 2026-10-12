import { describe, expect, it } from 'vitest';
import { presetSchema } from '@st/shared';
import { mapSillyTavernPreset } from './sillytavern-mapper.js';

// Deterministic ids: id-1, id-2, ...
function sequentialIds() {
  let next = 0;
  return () => `id-${++next}`;
}

const prompt = (identifier: string, extra: Record<string, unknown> = {}) => ({
  identifier,
  name: identifier,
  role: 'system',
  content: `${identifier} content`,
  ...extra,
});
const order = (character_id: number, entries: [string, boolean][]) => ({
  character_id,
  order: entries.map(([identifier, enabled]) => ({ identifier, enabled })),
});
const map = (file: unknown) => mapSillyTavernPreset(file, sequentialIds());

describe('order selection', () => {
  const prompts = [prompt('main'), prompt('nsfw'), prompt('jailbreak')];
  const names = (orders: unknown[]) => map({ prompts, prompt_order: orders }).entries.map((entry) => entry.name);

  it('prefers the global order (100001), then the stock order (100000), then the first entry', () => {
    expect(
      names([order(100000, [['main', true]]), order(100001, [['nsfw', true]]), order(42, [['jailbreak', true]])]),
    ).toEqual(['nsfw']);
    expect(names([order(42, [['jailbreak', true]]), order(100000, [['main', true]])])).toEqual(['main']);
    expect(names([order(42, [['jailbreak', true]]), order(43, [['main', true]])])).toEqual(['jailbreak']);
  });

  it('imports only listed prompts, in order, with enabled taken from the order entry', () => {
    const result = map({
      prompts,
      prompt_order: [
        order(100001, [
          ['jailbreak', false],
          ['main', true],
        ]),
      ],
    });
    expect(result.entries.map((entry) => [entry.name, entry.enabled])).toEqual([
      ['jailbreak', false],
      ['main', true],
    ]);
  });

  it('returns an empty preset when there is no order at all', () => {
    expect(map({ prompts }).entries).toEqual([]);
  });
});

describe('null and missing fields', () => {
  it('tolerates null roles, positions, names and content', () => {
    const result = map({
      prompts: [
        { identifier: 'loose', name: null, role: null, content: null, injection_position: null, injection_depth: null },
        { identifier: 'blank', name: '   ', role: 'narrator', content: 'hi' },
        { identifier: 'charDescription', marker: true, name: null, role: null, content: null },
      ],
      prompt_order: [
        order(100001, [
          ['loose', true],
          ['blank', true],
          ['charDescription', true],
        ]),
      ],
    });
    expect(result.entries).toEqual([
      {
        id: 'id-1',
        name: 'loose',
        enabled: true,
        kind: 'message',
        role: 'system',
        content: '',
        placement: { mode: 'ordered' },
      },
      {
        id: 'id-2',
        name: 'blank',
        enabled: true,
        kind: 'message',
        role: 'system',
        content: 'hi',
        placement: { mode: 'ordered' },
      },
      {
        id: 'id-3',
        name: 'charDescription',
        enabled: true,
        kind: 'message',
        role: 'system',
        content: '{{character.description}}',
        placement: { mode: 'ordered' },
      },
    ]);
  });

  it('rejects input that is not a JSON object', () => {
    expect(() => map(['not', 'an', 'object'])).toThrow(/Not a SillyTavern preset/);
    expect(() => map(null)).toThrow(/Not a SillyTavern preset/);
  });
});

describe('markers', () => {
  const markers = [
    'charDescription',
    'charPersonality',
    'scenario',
    'personaDescription',
    'dialogueExamples',
    'worldInfoBefore',
    'worldInfoAfter',
  ];
  const result = map({
    prompts: markers.map((identifier) => prompt(identifier, { marker: true, content: null })),
    prompt_order: [
      order(
        100001,
        markers.map((identifier) => [identifier, true]),
      ),
    ],
  });

  it('maps the four marker kinds with a macro equivalent to system messages', () => {
    expect(
      result.entries.slice(0, 4).map((entry) => (entry.kind === 'message' ? [entry.enabled, entry.content] : [])),
    ).toEqual([
      [true, '{{character.description}}'],
      [true, '{{character.personality}}'],
      [true, '{{character.scenario}}'],
      [true, '{{persona.description}}'],
    ]);
  });

  it('imports markers without an equivalent as disabled, empty entries named after the marker', () => {
    expect(result.entries.slice(4).map((entry) => [entry.name, entry.enabled, entry.kind])).toEqual([
      ['dialogueExamples', false, 'message'],
      ['worldInfoBefore', false, 'message'],
      ['worldInfoAfter', false, 'message'],
    ]);
    expect(result.entries.slice(4).every((entry) => entry.kind === 'message' && entry.content === '')).toBe(true);
  });

  it('maps chatHistory to a messages input and slot, followed by a current-message slot', () => {
    const history = map({
      prompts: [prompt('chatHistory', { marker: true, content: null })],
      prompt_order: [order(100001, [['chatHistory', true]])],
    });
    // Entry ids are generated first, then the inputs', then the current-message slot's.
    expect(history.inputs).toEqual([
      { id: 'id-2', key: 'history', dataType: 'messages' },
      { id: 'id-3', key: 'message', dataType: 'text' },
    ]);
    expect(history.entries).toEqual([
      { id: 'id-1', name: 'chatHistory', enabled: true, kind: 'slot', inputKey: 'history', role: 'user' },
      { id: 'id-4', name: 'Current message', enabled: true, kind: 'slot', inputKey: 'message', role: 'user' },
    ]);
  });

  it('disables the current-message slot together with a disabled chat history', () => {
    const history = map({
      prompts: [prompt('chatHistory', { marker: true, content: null })],
      prompt_order: [order(100001, [['chatHistory', false]])],
    });
    expect(history.entries.map((entry) => entry.enabled)).toEqual([false, false]);
  });
});

describe('depth injection', () => {
  const file = (injection: Record<string, unknown>, historyEnabled = true) => ({
    prompts: [
      prompt('main'),
      prompt('chatHistory', { marker: true, content: null }),
      prompt('note', { role: 'system', content: 'Remember', ...injection }),
    ],
    prompt_order: [
      order(100001, [
        ['main', true],
        ['chatHistory', historyEnabled],
        ['note', true],
      ]),
    ],
  });

  it('places an absolute prompt at its depth inside the enabled chat-history slot', () => {
    const result = map(file({ injection_position: 1, injection_depth: 2 }));
    const note = result.entries[3];
    expect(note).toMatchObject({ placement: { mode: 'depth', entryId: 'id-2', depth: 2 } });
    expect(result.entries[1]).toMatchObject({ id: 'id-2', kind: 'slot' });
  });

  it('falls back to ordered placement without an enabled chat-history slot', () => {
    expect(map(file({ injection_position: 1, injection_depth: 2 }, false)).entries[3]).toMatchObject({
      placement: { mode: 'ordered' },
    });
  });

  it('ignores depth for relative prompts and for depths that are not numbers', () => {
    expect(map(file({ injection_position: 0, injection_depth: 2 })).entries[3]).toMatchObject({
      placement: { mode: 'ordered' },
    });
    expect(map(file({ injection_position: 1, injection_depth: null })).entries[3]).toMatchObject({
      placement: { mode: 'ordered' },
    });
  });
});

describe('content and output shape', () => {
  it('keeps macros verbatim, including ones we do not support', () => {
    const content = 'Hi {{char}}, {{user}} meets {{getvar::mood}} {{unsupported}} <BOT>';
    const result = map({ prompts: [prompt('main', { content })], prompt_order: [order(100001, [['main', true]])] });
    expect(result.entries[0]).toMatchObject({ content });
  });

  it('maps the import to a structurally valid preset', () => {
    const result = map({
      prompts: [prompt('main'), prompt('chatHistory', { marker: true }), prompt('scenario', { marker: true })],
      prompt_order: [
        order(100001, [
          ['main', true],
          ['chatHistory', true],
          ['scenario', true],
        ]),
      ],
    });
    const preset = presetSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Imported',
      createdAt: '',
      updatedAt: '',
      ...result,
    });
    expect(preset.success).toBe(true);
  });
});
