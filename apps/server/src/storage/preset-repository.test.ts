import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, type MockInstance, vi } from 'vitest';
import type { Preset } from '@st/shared';
import { allocatePresetFile, presetFileStem } from './preset-filenames.js';
import { PresetRepository } from './preset-repository.js';
import { presetToYaml, parsePresetYaml } from './preset-yaml.js';

let directory: string;
let warn: MockInstance<typeof console.warn>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'preset-repo-test-'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  warn.mockRestore();
  await rm(directory, { recursive: true, force: true });
});

const date = '2026-01-01T00:00:00.000Z';
function preset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: randomUUID(),
    name: 'My Roleplay Preset',
    inputs: [{ id: randomUUID(), key: 'history', dataType: 'messages' }],
    entries: [
      {
        id: randomUUID(),
        name: 'Main',
        enabled: true,
        kind: 'message',
        role: 'system',
        content: 'Hi',
        placement: { mode: 'ordered' },
      },
      { id: randomUUID(), name: 'Chat history', enabled: true, kind: 'slot', inputKey: 'history', role: 'user' },
    ],
    createdAt: date,
    updatedAt: date,
    ...overrides,
  } as Preset;
}
const files = async () => (await readdir(directory)).sort();
const read = (name: string) => readFile(join(directory, name), 'utf8');
const messageContent = (preset: Preset, index = 0) => (preset.entries[index] as { content: string }).content;

const hostile = [
  '',
  ' leading space',
  'trailing space ',
  '\n',
  '\n\nleading newlines',
  'trailing newlines\n\n\n',
  'line one\r\nline two\r\n',
  'lone\rcarriage',
  'tab\tinside\n\tindented',
  '{{char}} said {{#if (eq user "x")}}hi{{/if}}',
  '\\{{escaped}}',
  '---\nnot a document separator\n...',
  '# not a comment\n  # nor this',
  'key: value\n- item\n? complex',
  'quotes \' and " and `',
  'true',
  'null',
  '~',
  '123',
  '0x1F',
  '1e3',
  'yes',
  '*alias',
  '&anchor',
  '!tag',
  '|',
  '>',
  '日本語 émoji 🙂 ünïcode\nsecond 行',
  '   \n   \n',
  'a\n \nb',
  'ends with colon:',
  '- leading dash',
  '\u2028 line separator \u0085 next line',
  '\u0000 nul and \u001b escape',
];

it('round-trips hostile strings and unknown fields at every level', () => {
  const original = preset({
    description: 'desc\nmulti',
    extraTop: { nested: ['a', { b: 1 }], flag: true },
    source: {
      app: 'sillytavern',
      installPath: 'C:/ST',
      user: 'u',
      file: 'f.json',
      hash: 'a'.repeat(64),
      importedAt: date,
      extraSource: 1,
    },
    inputs: [{ id: 'input-1', key: 'history', dataType: 'messages', extraInput: 'x' }],
    entries: [
      ...hostile.map((content, index) => ({
        id: `entry-${index + 1}`,
        name: `E${index}`,
        enabled: index % 2 === 0,
        kind: 'message' as const,
        role: 'user' as const,
        content,
        placement: { mode: 'ordered' as const },
        extraEntry: { content },
      })),
    ],
  } as Partial<Preset>);
  const parsed = parsePresetYaml(presetToYaml(original));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.preset).toEqual(original);
});

it('round-trips random strings', () => {
  const alphabet = [
    ' ',
    '\n',
    '\r',
    '\t',
    'a',
    'Z',
    '1',
    ':',
    '#',
    '-',
    '{',
    '}',
    '"',
    "'",
    '|',
    '>',
    '\\',
    'é',
    '🙂',
    '.',
    '?',
    '&',
    '*',
    '!',
    '%',
    '@',
    '`',
    ',',
  ];
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const strings = Array.from({ length: 400 }, () =>
    Array.from({ length: Math.floor(random() * 24) }, () => alphabet[Math.floor(random() * alphabet.length)]).join(''),
  );
  const original = preset({
    entries: strings.map((content, index) => ({
      id: `entry-${index + 1}`,
      name: `E${index}`,
      enabled: true,
      kind: 'message' as const,
      role: 'user' as const,
      content,
      placement: { mode: 'ordered' as const },
    })),
  });
  const parsed = parsePresetYaml(presetToYaml(original));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.preset.entries.map((entry) => (entry as { content: string }).content)).toEqual(strings);
});

it('writes multi-line content as readable block scalars and keeps bookkeeping last', () => {
  const text = presetToYaml(
    preset({
      entries: [
        {
          id: 'entry-1',
          name: 'Main',
          enabled: true,
          kind: 'message',
          role: 'system',
          content: 'Line one\n{{char}} line two\n',
          placement: { mode: 'ordered' },
        },
      ],
    }),
  );
  expect(text).toContain('content: |\n');
  expect(text).toContain('      Line one\n      {{char}} line two\n');
  expect(text.indexOf('name: My Roleplay Preset')).toBe(0);
  expect(text.indexOf('entries:')).toBeLessThan(text.indexOf('\nid: '));
  expect(text).not.toContain('placement');
  expect(text).not.toContain('entry-1');
});

it('keeps entry ids deterministic across reads of a hand-written file', async () => {
  const id = randomUUID();
  await writeFile(
    join(directory, 'hand.yaml'),
    `name: Hand written\nid: ${id}\ncreatedAt: ${date}\nupdatedAt: ${date}\ninputs:\n  - key: history\n    dataType: messages\nentries:\n  - name: Rules\n    kind: message\n    role: system\n    content: Be nice\n  - name: History\n    kind: slot\n    inputKey: history\n`,
  );
  const repository = new PresetRepository(directory);
  const first = await repository.get(id);
  const second = await repository.get(id);
  expect(first).toEqual(second);
  expect(first?.entries.map((entry) => entry.id)).toEqual(['entry-1', 'entry-2']);
  expect(first?.inputs[0]?.id).toBe('input-1');
  expect(first?.entries[0]).toMatchObject({ enabled: true, placement: { mode: 'ordered' } });
});

it('gives depth-targeted slots a readable label that placements reference', async () => {
  const slotId = randomUUID();
  const original = preset({
    entries: [
      {
        id: randomUUID(),
        name: 'Note',
        enabled: true,
        kind: 'message',
        role: 'system',
        content: 'n',
        placement: { mode: 'depth', entryId: slotId, depth: 1 },
      },
      { id: slotId, name: 'Chat History!', enabled: true, kind: 'slot', inputKey: 'history', role: 'user' },
    ],
  });
  const repository = new PresetRepository(directory);
  await repository.save(original);
  const text = await read((await files())[0]!);
  expect(text).toContain('id: chat-history');
  expect(text).toContain('entryId: chat-history');
  expect(text).not.toContain(slotId);
  const stored = await repository.get(original.id);
  expect(stored?.entries[1]?.id).toBe('chat-history');
  expect(stored?.entries[0]).toMatchObject({ placement: { mode: 'depth', entryId: 'chat-history', depth: 1 } });
  // Stable on a second write.
  await repository.update(original.id, (current) => current);
  expect(await read((await files())[0]!)).toBe(text);
});

it('stamps a missing id and timestamps once, keeping the file otherwise as written', async () => {
  const body =
    '# my preset\nname: Fresh\ninputs: []\nentries:\n  - name: A\n    kind: message\n    role: user\n    content: |\n      hello\n      there\n';
  await writeFile(join(directory, 'fresh.yaml'), body);
  const repository = new PresetRepository(directory);
  const [listed, again] = await Promise.all([repository.list(), repository.list()]);
  expect(listed).toHaveLength(1);
  expect(again[0]?.id).toBe(listed[0]?.id);
  const text = await read('fresh.yaml');
  expect(text.startsWith(body)).toBe(true);
  expect(text).toContain(`id: ${listed[0]!.id}`);
  expect(text.match(/^id:/gm)).toHaveLength(1);
  expect(await repository.list()).toEqual(listed);
  expect(await read('fresh.yaml')).toBe(text);
});

it('skips invalid YAML and invalid presets without touching them', async () => {
  await writeFile(join(directory, 'broken.yaml'), 'name: [unclosed\n');
  await writeFile(join(directory, 'wrong.yaml'), `name: ""\nid: ${randomUUID()}\ninputs: []\nentries: []\n`);
  await writeFile(join(directory, 'scalar.yaml'), 'just text\n');
  const repository = new PresetRepository(directory);
  await repository.save(preset());
  expect(await repository.list()).toHaveLength(2 - 1);
  expect(await read('broken.yaml')).toBe('name: [unclosed\n');
  expect(await read('scalar.yaml')).toBe('just text\n');
  const messages = warn.mock.calls.map((call) => String(call[0]));
  expect(messages.some((m) => m.includes('broken.yaml'))).toBe(true);
  expect(messages.some((m) => m.includes('wrong.yaml'))).toBe(true);
  // Repeated scans do not repeat the warning.
  const count = warn.mock.calls.length;
  await repository.list();
  expect(warn.mock.calls.length).toBe(count);
});

it('keeps the first file by name when two files declare the same id', async () => {
  const id = randomUUID();
  const body = (name: string) =>
    `name: ${name}\nid: ${id}\ncreatedAt: ${date}\nupdatedAt: ${date}\ninputs: []\nentries: []\n`;
  await writeFile(join(directory, 'b.yaml'), body('Second'));
  await writeFile(join(directory, 'a.yaml'), body('First'));
  const repository = new PresetRepository(directory);
  expect((await repository.list()).map((item) => item.name)).toEqual(['First']);
  expect(warn.mock.calls.some((call) => String(call[0]).includes('b.yaml'))).toBe(true);
  expect(await files()).toEqual(['a.yaml', 'b.yaml']);
});

it('slugs names safely and suffixes collisions case-insensitively', async () => {
  expect(presetFileStem('My Roleplay Preset!')).toBe('my-roleplay-preset');
  expect(presetFileStem('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
  expect(presetFileStem('CON')).toBe('con-preset');
  expect(presetFileStem('nul')).toBe('nul-preset');
  expect(presetFileStem('COM1')).toBe('com1-preset');
  expect(presetFileStem('trail. ')).toBe('trail');
  expect(presetFileStem('...')).toBe('preset');
  expect(presetFileStem('日本語 プリセット')).toBe('日本語-プリセット');
  expect(presetFileStem('x'.repeat(300)).length).toBe(80);
  expect(allocatePresetFile('a', new Set(['a', 'a-2']))).toBe('a-3.yaml');

  const repository = new PresetRepository(directory);
  await repository.save(preset({ name: 'Same Name' }));
  await repository.save(preset({ name: 'same name' }));
  await repository.save(preset({ name: 'SAME-NAME' }));
  await repository.save(preset({ name: '???' }));
  expect(await files()).toEqual(['preset.yaml', 'same-name-2.yaml', 'same-name-3.yaml', 'same-name.yaml']);
});

it('renames the file when the name changes and only then', async () => {
  const repository = new PresetRepository(directory);
  const original = preset({ name: 'Old Name' });
  await repository.save(original);
  await repository.update(original.id, (current) => ({ ...current, description: 'edited' }));
  expect(await files()).toEqual(['old-name.yaml']);
  await repository.update(original.id, (current) => ({ ...current, name: 'New Name' }));
  expect(await files()).toEqual(['new-name.yaml']);
  expect((await repository.get(original.id))?.name).toBe('New Name');
});

it('finds a preset by id after the user renamed its file by hand', async () => {
  const repository = new PresetRepository(directory);
  const original = preset({ name: 'Named' });
  await repository.save(original);
  await rm(join(directory, 'named.yaml'), { force: true }).catch(() => {});
  await writeFile(join(directory, 'my-own-name.yaml'), presetToYaml(original));
  expect((await repository.get(original.id))?.name).toBe('Named');
  await repository.update(original.id, (current) => ({ ...current, description: 'x' }));
  expect(await files()).toEqual(['my-own-name.yaml']);
});

it('update returns undefined for unknown ids and deletes only the preset file', async () => {
  const repository = new PresetRepository(directory);
  expect(await repository.update(randomUUID(), (current) => current)).toBeUndefined();
  const a = preset({ name: 'A' });
  const b = preset({ name: 'B' });
  await repository.save(a);
  await repository.save(b);
  await writeFile(join(directory, 'a.json.migrated'), '{}');
  const seen = vi.fn();
  await repository.delete(a.id, seen);
  expect(seen).toHaveBeenCalledWith(expect.objectContaining({ id: a.id }));
  expect(await files()).toEqual(['a.json.migrated', 'b.yaml']);
  await repository.delete(randomUUID());
});

it('serializes concurrent updates of one preset', async () => {
  const repository = new PresetRepository(directory);
  const original = preset({ description: '0' });
  await repository.save(original);
  await Promise.all(
    Array.from({ length: 20 }, () =>
      repository.update(original.id, async (current) => {
        const next = Number(current.description) + 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { ...current, description: String(next) };
      }),
    ),
  );
  expect((await repository.get(original.id))?.description).toBe('20');
  expect(await files()).toHaveLength(1);
});

it('stores hostile content through the repository byte for byte', async () => {
  const repository = new PresetRepository(directory);
  const original = preset({
    entries: hostile.map((content, index) => ({
      id: randomUUID(),
      name: `E${index}`,
      enabled: true,
      kind: 'message' as const,
      role: 'user' as const,
      content,
      placement: { mode: 'ordered' as const },
    })),
  });
  await repository.save(original);
  const stored = await repository.get(original.id);
  expect(stored?.entries.map((_, index) => messageContent(stored, index))).toEqual(hostile);
});
