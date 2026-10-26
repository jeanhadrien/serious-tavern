import { describe, expect, it } from 'vitest';
import { presetInputLabel, presetSchema, presetWarnings, upgradeLegacyPreset } from './preset.js';
import { findMacro, macroHints } from './macros.js';
import type { StateDefinition, StateKeyDef } from './state/definition.js';
import { stateHints } from './state/snapshot.js';

const base = () => ({
  id: 'e305f530-421a-492b-9d25-fbb054f28c04',
  name: 'Test',
  createdAt: '',
  updatedAt: '',
  inputs: [
    { id: 'history-input', key: 'history', dataType: 'messages' as const },
    { id: 'message-input', key: 'message', dataType: 'text' as const },
  ],
  entries: [
    { id: 'history-slot', kind: 'slot' as const, enabled: true, displayName: 'History', inputKey: 'history' },
    {
      id: 'injection',
      kind: 'message' as const,
      enabled: true,
      displayName: 'Note',
      role: 'system' as const,
      content: 'Remember',
      placement: { mode: 'depth' as const, entryId: 'history-slot', depth: 0 },
    },
    { id: 'message-slot', kind: 'slot' as const, enabled: true, displayName: 'Message', inputKey: 'message' },
  ],
});

it('derives input display labels from keys', () => {
  expect(presetInputLabel('history')).toBe('History');
  expect(presetInputLabel('chat_history')).toBe('Chat history');
  expect(presetInputLabel('userMessage')).toBe('User message');
});

it('uses the registry for hints and warns on unknown macros only in enabled messages', () => {
  const parsed = presetSchema.parse({
    ...base(),
    entries: [
      {
        id: 'active',
        kind: 'message',
        enabled: true,
        displayName: 'Active',
        role: 'system',
        content:
          '{{unknown}} {{char.name}} {{user.description}} {{random::a::b}} {{CHARACTER.Name}} {{input.message}} {{inputs.history}}',
      },
      {
        id: 'disabled',
        kind: 'message',
        enabled: false,
        displayName: 'Disabled',
        role: 'system',
        content: '{{disabled}}',
      },
    ],
  });
  expect(presetWarnings(parsed)).toEqual(
    ['{{unknown}}', '{{char.name}}', '{{user.description}}', '{{random::a::b}}', '{{CHARACTER.Name}}'].map(
      (expression) => ({
        path: ['entries', 0, 'content'],
        message: `Unknown macro: ${expression}`,
      }),
    ),
  );
  const hints = macroHints(parsed.inputs);
  expect(hints).toContainEqual(expect.objectContaining({ expression: '{{input.message}}', type: 'text' }));
  expect(hints).toContainEqual(expect.objectContaining({ expression: '{{character.creator_notes}}' }));
  expect(hints).toContainEqual(
    expect.objectContaining({ expression: '{{#each input.history}}{{/each}}', type: 'messages' }),
  );
  const variables = hints.filter((hint) => !hint.expression.startsWith('{{#') && !hint.expression.startsWith('{{!'));
  expect(variables.every((hint) => findMacro(hint.expression.slice(2, -2)) !== undefined)).toBe(true);
  expect(hints.some((hint) => hint.expression.startsWith('{{char.') || hint.expression.startsWith('{{user.'))).toBe(
    false,
  );
});

it('validates input references case-sensitively and rejects ambiguous input keys', () => {
  const message = { id: 'm', kind: 'message', enabled: true, displayName: 'M', role: 'system' };
  expect(presetSchema.safeParse({ ...base(), entries: [{ ...message, content: '{{input.message}}' }] }).success).toBe(
    true,
  );
  expect(presetSchema.safeParse({ ...base(), entries: [{ ...message, content: '{{input.Missing}}' }] }).success).toBe(
    false,
  );
  expect(presetSchema.safeParse({ ...base(), entries: [{ ...message, content: '{{INPUT.MESSAGE}}' }] }).success).toBe(
    true,
  );
  expect(presetSchema.safeParse({ ...base(), entries: [{ ...message, content: '{{input.MESSAGE}}' }] }).success).toBe(
    false,
  );
  expect(
    presetSchema.safeParse({ ...base(), inputs: [...base().inputs, { id: 'h', key: 'hISTORY', dataType: 'text' }] })
      .success,
  ).toBe(false);
});

describe('preset schema', () => {
  it('parses ordered placement and defaults slot role', () => {
    const parsed = presetSchema.parse({
      ...base(),
      entries: [
        { id: 'slot', kind: 'slot', enabled: true, displayName: 'Message', inputKey: 'message' },
        { id: 'message', kind: 'message', enabled: true, displayName: 'Hello', role: 'user', content: 'Hi' },
      ],
    });
    expect(parsed.entries).toMatchObject([{ role: 'user' }, { placement: { mode: 'ordered' } }]);
  });

  it('rejects invalid and duplicate input keys and duplicate entry ids at useful paths', () => {
    const duplicate = presetSchema.safeParse({
      ...base(),
      inputs: [...base().inputs, { id: 'other', key: 'history', dataType: 'text' }],
    });
    expect(duplicate.success).toBe(false);
    if (!duplicate.success)
      expect(duplicate.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['inputs', 2, 'key'],
          message: 'Duplicate input key: history',
        }),
      );
    expect(
      presetSchema.safeParse({ ...base(), inputs: [{ id: 'bad', key: 'Bad-key', dataType: 'text' }] }).success,
    ).toBe(false);
    const duplicateEntry = presetSchema.safeParse({
      ...base(),
      entries: [...base().entries, { ...base().entries[0], name: 'Again' }],
    });
    expect(duplicateEntry.success).toBe(false);
    if (!duplicateEntry.success)
      expect(duplicateEntry.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['entries', 3, 'id'],
          message: 'Duplicate entry id: history-slot',
        }),
      );
  });

  it('rejects slots for unknown inputs', () => {
    const result = presetSchema.safeParse({
      ...base(),
      entries: [{ id: 'unknown', kind: 'slot', enabled: true, displayName: 'Missing', inputKey: 'missing' }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['entries', 0, 'inputKey'],
          message: 'Unknown input: missing',
        }),
      );
  });

  it('rejects depth placements that do not point to an enabled messages slot', () => {
    for (const target of ['absent', 'message-slot', 'disabled-slot']) {
      const result = presetSchema.safeParse({
        ...base(),
        entries: base().entries.map((entry) =>
          entry.id === 'injection' ? { ...entry, placement: { mode: 'depth', entryId: target, depth: 0 } } : entry,
        ),
      });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues.some((issue) => issue.path.join('.') === 'entries.1.placement.entryId')).toBe(true);
    }
    const disabled = presetSchema.safeParse({
      ...base(),
      entries: base().entries.map((entry) => (entry.id === 'history-slot' ? { ...entry, enabled: false } : entry)),
    });
    expect(disabled.success).toBe(false);
    const wrongType = presetSchema.safeParse({
      ...base(),
      inputs: base().inputs.map((input) => (input.key === 'history' ? { ...input, dataType: 'text' as const } : input)),
    });
    expect(wrongType.success).toBe(false);
    expect(
      presetSchema.safeParse({
        ...base(),
        entries: base().entries.map((entry) =>
          entry.id === 'injection'
            ? { ...entry, placement: { mode: 'depth', entryId: 'history-slot', depth: -1 } }
            : entry,
        ),
      }).success,
    ).toBe(false);
  });

  it('rejects unknown input template references on the content path', () => {
    const result = presetSchema.safeParse({
      ...base(),
      entries: [
        {
          id: 'message',
          kind: 'message',
          enabled: true,
          displayName: 'System',
          role: 'system',
          content: '{{input.missing}} and {{input.Unknown}}',
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.filter((issue) => issue.path.join('.') === 'entries.0.content')).toHaveLength(2);
  });
});

it('warns when an input is unused by enabled slots or message templates', () => {
  const parsed = presetSchema.parse({
    ...base(),
    entries: [
      {
        id: 'message',
        kind: 'message',
        enabled: true,
        displayName: 'System',
        role: 'system',
        content: 'Use {{input.message}}',
      },
      { id: 'disabled', kind: 'slot', enabled: false, displayName: 'Disabled slot', inputKey: 'history' },
    ],
  });
  expect(presetWarnings(parsed)).toEqual([
    { path: ['inputs', 0], message: 'Input "history" is not used by an enabled entry.' },
  ]);
});

it('accepts a server-owned import source and rejects a malformed hash', () => {
  const source = {
    app: 'sillytavern',
    installPath: 'C:/SillyTavern',
    user: 'default-user',
    file: 'Default.json',
    hash: 'a'.repeat(64),
    importedAt: '',
  };
  expect(presetSchema.parse({ ...base(), source }).source).toEqual(source);
  expect(presetSchema.safeParse({ ...base(), source: { ...source, hash: 'short' } }).success).toBe(false);
});

describe('block templates', () => {
  const message = (content: string) => ({
    id: 'm',
    kind: 'message' as const,
    enabled: true,
    displayName: 'M',
    role: 'system' as const,
    content,
  });
  const historySlot = {
    id: 'history-slot',
    kind: 'slot' as const,
    enabled: true,
    displayName: 'History',
    inputKey: 'history',
  };
  const messageSlot = {
    id: 'message-slot',
    kind: 'slot' as const,
    enabled: true,
    displayName: 'Message',
    inputKey: 'message',
  };
  const withContent = (content: string) => presetSchema.safeParse({ ...base(), entries: [message(content)] });

  it('reports unknown input references inside blocks and subexpressions as errors', () => {
    for (const content of [
      '{{#if input.missing}}x{{/if}}',
      '{{#if (eq input.missing "a")}}x{{/if}}',
      '{{#each input.history}}{{input.missing}}{{/each}}',
    ])
      expect(withContent(content).success, content).toBe(false);
    expect(
      withContent('{{#if (eq input.message "a")}}{{#each input.history}}{{this.role}}{{/each}}{{/if}}').success,
    ).toBe(true);
  });

  it('warns on unknown paths, relative paths are not checked, and helper names are never flagged', () => {
    const parsed = presetSchema.parse({
      ...base(),
      entries: [
        message(
          '{{#if (eq character.name "aeaze")}}{{#each input.history}}{{this.role}} {{content}} {{../unknown}}{{/each}}{{/if}}',
        ),
        historySlot,
        messageSlot,
      ],
    });
    expect(presetWarnings(parsed)).toEqual([
      { path: ['entries', 0, 'content'], message: 'Unknown macro: {{../unknown}}' },
    ]);
  });

  it('warns instead of failing on syntax errors and unsupported constructs', () => {
    const parsed = presetSchema.parse({
      ...base(),
      entries: [
        message('{{#if input.message}}open'),
        { ...message('{{format input.message}}'), id: 'helper' },
        messageSlot,
        historySlot,
      ],
    });
    expect(presetWarnings(parsed)).toEqual([
      { path: ['entries', 0, 'content'], message: expect.stringMatching(/^Template syntax error: /) },
      { path: ['entries', 1, 'content'], message: 'Unknown helper: format' },
    ]);
  });

  it('counts an input used only inside a block as used', () => {
    const parsed = presetSchema.parse({
      ...base(),
      entries: [message('{{#if input.message}}{{/if}}'), historySlot],
    });
    expect(presetWarnings(parsed)).toEqual([]);
  });
});

describe('message names', () => {
  const named = (name: string, content = 'Hi') => ({
    ...base(),
    entries: [
      ...base().entries,
      { id: 'named', kind: 'message', enabled: true, displayName: 'Named', role: 'user', content, name },
    ],
  });

  it('rejects unknown inputs in a name on the name path', () => {
    const result = presetSchema.safeParse(named('{{input.missing}}'));
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
        ['entries.3.name', 'Unknown input: missing'],
      ]);
  });

  it('warns on unknown macros and syntax problems in a name', () => {
    expect(presetWarnings(presetSchema.parse(named('{{nope}}')))).toEqual([
      { path: ['entries', 3, 'name'], message: 'Unknown macro: {{nope}}' },
    ]);
    const broken = presetWarnings(presetSchema.parse(named('{{#if}}')));
    expect(broken.map((warning) => warning.path)).toEqual([['entries', 3, 'name']]);
  });

  it('counts an input referenced only by a name as used', () => {
    const preset = named('{{input.message}}');
    preset.entries = preset.entries.filter((entry) => entry.id !== 'message-slot');
    expect(presetWarnings(presetSchema.parse(preset))).toEqual([]);
  });
});

describe('message reasoning', () => {
  const thinking = (reasoning: string, role = 'assistant') => ({
    ...base(),
    entries: [
      ...base().entries,
      { id: 'thinking', kind: 'message', enabled: true, displayName: 'Thinking', role, content: 'Hi', reasoning },
    ],
  });

  it('checks the reasoning of an assistant entry like its content', () => {
    const result = presetSchema.safeParse(thinking('{{input.missing}}'));
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
        ['entries.3.reasoning', 'Unknown input: missing'],
      ]);
    expect(presetWarnings(presetSchema.parse(thinking('{{nope}}')))).toEqual([
      { path: ['entries', 3, 'reasoning'], message: 'Unknown macro: {{nope}}' },
    ]);
  });

  it('ignores the reasoning of another role, with a warning', () => {
    expect(presetSchema.safeParse(thinking('{{input.missing}}', 'user')).success).toBe(true);
    expect(presetWarnings(presetSchema.parse(thinking('Why', 'system')))).toEqual([
      {
        path: ['entries', 3, 'reasoning'],
        message: 'Reasoning is only sent on assistant messages; it is ignored here.',
      },
    ]);
  });
});

describe('upgradeLegacyPreset', () => {
  it('turns a legacy entry name into its displayName and leaves new-shape entries alone', () => {
    const raw = {
      name: 'Preset',
      entries: [
        { id: 'a', name: 'Main', kind: 'message', content: 'x' },
        { id: 'b', displayName: 'Note', name: '{{char}}', kind: 'message', content: 'y' },
        { id: 'c', name: 'History', kind: 'slot', inputKey: 'history' },
        'not an entry',
      ],
    };
    const before = structuredClone(raw);
    expect(upgradeLegacyPreset(raw)).toEqual({
      name: 'Preset',
      entries: [
        { id: 'a', displayName: 'Main', kind: 'message', content: 'x' },
        { id: 'b', displayName: 'Note', name: '{{char}}', kind: 'message', content: 'y' },
        { id: 'c', displayName: 'History', kind: 'slot', inputKey: 'history' },
        'not an entry',
      ],
    });
    expect(raw).toEqual(before);
    expect(upgradeLegacyPreset('text')).toBe('text');
  });
});

describe('chat settings macros', () => {
  it('knows settings paths and does not warn about them', () => {
    expect(findMacro('settings.volatility')?.category).toBe('settings');
    expect(findMacro('settings')?.dataType).toBe('object');
    const parsed = presetSchema.parse({
      ...base(),
      inputs: [],
      entries: [
        {
          id: 'note',
          kind: 'message',
          enabled: true,
          displayName: 'Note',
          role: 'system',
          content:
            '{{#if settings.authorsNote}}[{{settings.authorsNote}}]{{/if}} {{settings}} {{#if (gt settings.v 0.5)}}x{{/if}}',
        },
      ],
    });
    expect(presetWarnings(parsed)).toEqual([]);
  });

  it('hints one settings path per declared setting, typed by the setting', () => {
    const hints = macroHints(
      [{ key: 'message', dataType: 'text' }],
      [
        { key: 'volatility', type: 'number', description: 'How wild' },
        { key: 'mood', type: 'enum' },
      ],
    );
    expect(hints).toContainEqual({ expression: '{{settings.volatility}}', description: 'How wild', type: 'number' });
    expect(hints).toContainEqual({ expression: '{{settings.mood}}', description: 'Chat setting', type: 'text' });
    expect(hints).toContainEqual(expect.objectContaining({ expression: '{{settings}}' }));
    expect(macroHints([]).some((hint) => hint.expression.startsWith('{{settings.'))).toBe(false);
    const variables = hints.filter((hint) => !hint.expression.startsWith('{{#') && !hint.expression.startsWith('{{!'));
    expect(variables.every((hint) => findMacro(hint.expression.slice(2, -2)) !== undefined)).toBe(true);
  });

  it('hints only usable keys, once each, so half-typed draft declarations give no bogus hints', () => {
    const hints = macroHints(
      [],
      [
        { key: '', type: 'text' },
        { key: '1st', type: 'text' },
        { key: 'mood', type: 'enum' },
        { key: 'mood', type: 'number' },
      ],
    ).filter((hint) => hint.expression.startsWith('{{settings.'));
    expect(hints).toEqual([{ expression: '{{settings.mood}}', description: 'Chat setting', type: 'text' }]);
  });
});

describe('story state macros', () => {
  const definition = (name: string, keys: Record<string, StateKeyDef>, over: Partial<StateDefinition> = {}) => ({
    id: '11111111-1111-4111-8111-111111111111',
    name,
    keys,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  });
  const scene = definition('scene', {
    tension: { type: 'number', min: 0, max: 10 },
    mood: { type: 'enum', options: ['calm', 'tense'] },
    injected: { type: 'collection', cap: 30 },
  });

  it('knows trigger.turn and state paths, and does not warn about them', () => {
    expect(findMacro('trigger.turn')).toMatchObject({ category: 'trigger', dataType: 'number', field: 'turn' });
    expect(findMacro('state')).toMatchObject({ category: 'state', dataType: 'object' });
    for (const path of ['state.scene', 'state.scene.tension', 'state.anything.at.all'])
      expect(findMacro(path)).toMatchObject({ category: 'state', source: 'state' });
    // Other trigger paths keep resolving through the pattern.
    expect(findMacro('trigger.sessionId')?.name).toBe('trigger.sessionId');
    expect(findMacro('trigger.other')?.name).toBe('trigger.<path>');
    const parsed = presetSchema.parse({
      ...base(),
      inputs: [],
      entries: [
        {
          id: 'note',
          kind: 'message',
          enabled: true,
          displayName: 'Note',
          role: 'system',
          content:
            'Turn {{trigger.turn}}: {{state.scene.tension}} {{state}} {{#each state.scene.injected}}{{this.text}}{{/each}} {{#if (gt state.scene.tension 5)}}x{{/if}} {{state.unknown.key}}',
        },
      ],
    });
    expect(presetWarnings(parsed)).toEqual([]);
    // Lookalikes are not state macros.
    expect(findMacro('State.scene.tension')).toBeUndefined();
    expect(findMacro('states.scene')).toBeUndefined();
  });

  it('hints one state path per definition key, typed by the key, and a loop for collections', () => {
    const hints = macroHints([], [], stateHints([scene]));
    expect(hints).toContainEqual({
      expression: '{{state.scene.tension}}',
      description: 'Story state: Number from 0 to 10',
      type: 'number',
    });
    expect(hints).toContainEqual(expect.objectContaining({ expression: '{{state.scene.mood}}', type: 'text' }));
    expect(hints).toContainEqual(expect.objectContaining({ expression: '{{state.scene.injected}}', type: 'array' }));
    expect(hints).toContainEqual(
      expect.objectContaining({ expression: '{{#each state.scene.injected}}{{/each}}', type: 'array' }),
    );
    expect(hints).toContainEqual(expect.objectContaining({ expression: '{{trigger.turn}}', type: 'number' }));
    expect(hints).toContainEqual(expect.objectContaining({ expression: '{{state}}' }));
    const variables = hints.filter((hint) => !hint.expression.startsWith('{{#') && !hint.expression.startsWith('{{!'));
    expect(variables.every((hint) => findMacro(hint.expression.slice(2, -2)) !== undefined)).toBe(true);
    // Only collections get a loop.
    expect(hints.filter((hint) => hint.expression.startsWith('{{#each state.')).length).toBe(1);
  });

  it('hints the linked loop for collections, and the helper is valid in a preset', () => {
    const hints = macroHints([], [], stateHints([scene]));
    expect(hints.filter((hint) => hint.expression.startsWith('{{#each (linked'))).toEqual([
      expect.objectContaining({ expression: '{{#each (linked state.scene.injected)}}{{/each}}', type: 'array' }),
    ]);
    const parsed = presetSchema.parse({
      ...base(),
      inputs: [],
      entries: [
        {
          id: 'summaries',
          kind: 'message',
          enabled: true,
          displayName: 'Summaries',
          role: 'system',
          content:
            '{{#each (linked state.scene.injected)}}{{text}} {{/each}}{{#if (linked state.scene.injected)}}!{{/if}}',
        },
      ],
    });
    expect(presetWarnings(parsed)).toEqual([]);
  });

  it('hints no state path without definitions, and the first definition of a repeated name', () => {
    expect(macroHints([]).some((hint) => hint.expression.startsWith('{{state.'))).toBe(false);
    expect(macroHints([], [], []).some((hint) => hint.expression.startsWith('{{state.'))).toBe(false);
    const older = definition('scene', { a: { type: 'text' } }, { id: 'o', createdAt: '2025-01-01' });
    const hints = macroHints([], [], stateHints([scene, older])).filter((hint) =>
      hint.expression.startsWith('{{state.'),
    );
    expect(hints.map((hint) => hint.expression)).toEqual(['{{state.scene.a}}']);
  });
});
