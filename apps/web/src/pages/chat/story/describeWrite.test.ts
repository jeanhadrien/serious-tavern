import { expect, it } from 'vitest';
import { describeWrite, itemTexts, type TurnWrite } from './describeWrite.js';
import { addWrite, buildView, drawWrite, entry, reply, setWrite } from './fixtures.js';

const named = (write: TurnWrite['write'], extra: Partial<TurnWrite> = {}): TurnWrite => ({
  write,
  definitionName: 'scene',
  ...extra,
});
const texts = new Map<string, string>();

it.each([
  [setWrite('tension', 6), 'scene.tension → 6'],
  [setWrite('tension', -2.5), 'scene.tension → -2.5'],
  [setWrite('tension', 0), 'scene.tension → 0'],
  [setWrite('mood', 'tense'), "scene.mood → 'tense'"],
  [setWrite('mood', ''), "scene.mood → ''"],
  [setWrite('quiet', true), 'scene.quiet → true'],
  [setWrite('quiet', false), 'scene.quiet → false'],
  [setWrite('flags', { a: 1, b: 'x' }), 'scene.flags → {"a":1,"b":"x"}'],
  [setWrite('flags', null), 'scene.flags → none'],
  [{ ...setWrite('tension', 0), op: 'delete' as const }, 'scene.tension reset to its default'],
  [addWrite('injected', 'i1', 'a bell on a lost animal'), "scene.injected + 'a bell on a lost animal'"],
  [addWrite('injected', 'i1', 'a bell', { level: 2 }), "scene.injected + 'a bell' (level 2)"],
  [
    addWrite('injected', 'i1', 'a bell', { level: 2, mood: 'calm', entryKey: 'x' }),
    "scene.injected + 'a bell' (level 2, mood calm)",
  ],
])('words a definition write: %#', (write, expected) => {
  expect(describeWrite(named(write), texts)).toBe(expected);
});

it('cuts long text with an ellipsis', () => {
  const line = describeWrite(named(addWrite('injected', 'i1', 'x'.repeat(100))), texts);
  expect(line).toBe(`scene.injected + '${'x'.repeat(59)}…'`);
  expect(describeWrite(named(setWrite('place', 'y'.repeat(100))), texts)).toBe(`scene.place → '${'y'.repeat(59)}…'`);
});

it('names a removed item by the text it was added with, or "an item"', () => {
  const remove = { ...addWrite('injected', 'i1', ''), op: 'remove' as const, itemId: 'i1' };
  expect(describeWrite(named(remove), new Map([['i1', 'a bell on a lost animal']]))).toBe(
    "scene.injected: removed 'a bell on a lost animal'",
  );
  expect(describeWrite(named(remove), texts)).toBe('scene.injected: removed an item');
});

it('says "(deleted definition)" when the definition is gone', () => {
  expect(describeWrite({ write: setWrite('tension', 6) }, texts)).toBe('(deleted definition).tension → 6');
});

it("words Draw's memory as a draw and other node memory as remembered", () => {
  const label = 'Draw #1 (draw)';
  expect(describeWrite({ write: drawWrite('d1', 'resin smell'), nodeLabel: label }, texts)).toBe(
    "Draw #1 (draw): drew 'resin smell'",
  );
  const other = { ...drawWrite('d1', 'x'), target: { kind: 'node' as const, nodeId: 'draw', key: 'seen' } };
  expect(describeWrite({ write: other, nodeLabel: 'Custom #1 (custom)' }, texts)).toBe(
    "Custom #1 (custom): remembered 'x' (seen)",
  );
  const set = { ...other, op: 'set' as const, value: 3 };
  expect(describeWrite({ write: set, nodeLabel: 'Custom #1 (custom)' }, texts)).toBe('Custom #1 (custom): seen → 3');
});

it('names a node that no longer exists', () => {
  expect(describeWrite({ write: drawWrite('d1', 'resin smell') }, texts)).toBe("A removed node: drew 'resin smell'");
});

it('collects the text of every added item of the view, for naming removals', () => {
  const view = buildView({
    messages: [reply('e1'), reply('e2')],
    entries: [
      entry('e1', [addWrite('injected', 'i1', 'a bell'), drawWrite('d1', 'resin')]),
      entry('e2', [addWrite('injected', 'i2', 'a cart'), setWrite('tension', 4)]),
    ],
  });
  expect(itemTexts(view)).toEqual(
    new Map([
      ['i1', 'a bell'],
      ['d1', 'resin'],
      ['i2', 'a cart'],
    ]),
  );
});
