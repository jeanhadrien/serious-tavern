import { describe, expect, it } from 'vitest';
import { presetInputLabel, presetSchema, presetWarnings } from './preset.js';
import { findMacro, macroHints } from './macros.js';

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
    { id: 'history-slot', kind: 'slot' as const, enabled: true, name: 'History', inputKey: 'history' },
    {
      id: 'injection',
      kind: 'message' as const,
      enabled: true,
      name: 'Note',
      role: 'system' as const,
      content: 'Remember',
      placement: { mode: 'depth' as const, entryId: 'history-slot', depth: 0 },
    },
    { id: 'message-slot', kind: 'slot' as const, enabled: true, name: 'Message', inputKey: 'message' },
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
        name: 'Active',
        role: 'system',
        content:
          '{{unknown}} {{char.name}} {{user.description}} {{random::a::b}} {{CHARACTER.Name}} {{input.message}} {{inputs.history}}',
      },
      { id: 'disabled', kind: 'message', enabled: false, name: 'Disabled', role: 'system', content: '{{disabled}}' },
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
  const message = { id: 'm', kind: 'message', enabled: true, name: 'M', role: 'system' };
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
        { id: 'slot', kind: 'slot', enabled: true, name: 'Message', inputKey: 'message' },
        { id: 'message', kind: 'message', enabled: true, name: 'Hello', role: 'user', content: 'Hi' },
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
      entries: [{ id: 'unknown', kind: 'slot', enabled: true, name: 'Missing', inputKey: 'missing' }],
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
          name: 'System',
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
        name: 'System',
        role: 'system',
        content: 'Use {{input.message}}',
      },
      { id: 'disabled', kind: 'slot', enabled: false, name: 'Disabled slot', inputKey: 'history' },
    ],
  });
  expect(presetWarnings(parsed)).toEqual([
    { path: ['inputs', 0], message: 'Input "history" is not used by an enabled entry.' },
  ]);
});

describe('block templates', () => {
  const message = (content: string) => ({
    id: 'm',
    kind: 'message' as const,
    enabled: true,
    name: 'M',
    role: 'system' as const,
    content,
  });
  const historySlot = {
    id: 'history-slot',
    kind: 'slot' as const,
    enabled: true,
    name: 'History',
    inputKey: 'history',
  };
  const messageSlot = {
    id: 'message-slot',
    kind: 'slot' as const,
    enabled: true,
    name: 'Message',
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
