import { describe, expect, it } from 'vitest';
import type { ReplyEntry, Workflow } from '@st/shared';
import {
  addEntry,
  addableWorkflows,
  anyEnabled,
  copiedList,
  listedWorkflows,
  moveEntry,
  removeEntry,
  replyRows,
  rowLabel,
  toggleEntry,
} from './replyList.js';

const workflow = (id: string, name = id.toUpperCase()): Workflow => ({
  id,
  name,
  nodes: [],
  edges: [],
  createdAt: '',
  updatedAt: '',
});
const entry = (workflowId: string, enabled = true): ReplyEntry => ({ workflowId, enabled });
const all = [workflow('a', 'Narrator'), workflow('b', 'Memory'), workflow('c', 'Aside')];

describe('rows', () => {
  it('names each entry by its workflow, in list order, and offers Remove only while there is more than one', () => {
    const rows = replyRows([entry('b'), entry('a', false)], all);
    expect(rows.map((row) => [row.workflowId, row.name, row.enabled, row.removable])).toEqual([
      ['b', 'Memory', true, true],
      ['a', 'Narrator', false, true],
    ]);
    expect(replyRows([entry('a')], all)[0]?.removable).toBe(false);
  });

  it('keeps an entry whose workflow is gone, under an unknown name', () => {
    const [row] = replyRows([entry('gone')], all);
    expect(row?.name).toBeUndefined();
    expect(rowLabel(row!)).toBe('Unknown workflow (gone)');
    expect(rowLabel({ workflowId: 'a', name: 'Narrator' })).toBe('Narrator');
  });

  it('lists the workflows that exist, in list order, for the settings', () => {
    expect(listedWorkflows([entry('c'), entry('gone'), entry('a', false)], all).map((w) => w.id)).toEqual(['c', 'a']);
  });
});

describe('changes', () => {
  it('adds a workflow at the end, on, and never twice', () => {
    expect(addEntry([entry('a')], 'b')).toEqual([entry('a'), entry('b')]);
    expect(addEntry([entry('a'), entry('b', false)], 'b')).toEqual([entry('a'), entry('b', false)]);
  });

  it('offers only the workflows not listed, by name', () => {
    expect(addableWorkflows([entry('b')], all).map((w) => w.name)).toEqual(['Aside', 'Narrator']);
    expect(addableWorkflows([entry('a'), entry('b'), entry('c')], all)).toEqual([]);
  });

  it('never removes the last entry', () => {
    expect(removeEntry([entry('a'), entry('b')], 'a')).toEqual([entry('b')]);
    expect(removeEntry([entry('a')], 'a')).toEqual([entry('a')]);
  });

  it('toggles one entry and keeps what else is stored on it', () => {
    const stored = [{ ...entry('a'), later: 1 }, entry('b')];
    expect(toggleEntry(stored, 'a')).toEqual([{ workflowId: 'a', enabled: false, later: 1 }, entry('b')]);
    expect(toggleEntry(stored, 'zzz')).toEqual(stored);
  });

  it('moves an entry and never changes its input', () => {
    const list = [entry('a'), entry('b'), entry('c')];
    expect(moveEntry(list, 0, 2).map((item) => item.workflowId)).toEqual(['b', 'c', 'a']);
    expect(list.map((item) => item.workflowId)).toEqual(['a', 'b', 'c']);
  });

  it('knows when nothing would run', () => {
    expect(anyEnabled([entry('a', false), entry('b', false)])).toBe(false);
    expect(anyEnabled([entry('a', false), entry('b')])).toBe(true);
  });
});

describe('the list a new chat starts with', () => {
  it('copies the open chat, order and switches included', () => {
    const triggers = { reply: [entry('b', false), entry('a')] };
    expect(copiedList({ workflowId: 'b', triggers }, all)).toEqual([entry('b', false), entry('a')]);
  });

  it('copies an older chat as its workflow alone', () => {
    expect(copiedList({ workflowId: 'c' }, all)).toEqual([entry('c')]);
  });

  it('leaves out workflows that no longer exist, and copies nothing when none is left or no chat is open', () => {
    expect(copiedList({ workflowId: 'a', triggers: { reply: [entry('gone'), entry('a')] } }, all)).toEqual([
      entry('a'),
    ]);
    expect(copiedList({ workflowId: 'gone' }, all)).toBeUndefined();
    expect(copiedList(undefined, all)).toBeUndefined();
  });

  it('copies only the workflow and its switch, not what else is stored on an entry', () => {
    const triggers = { reply: [{ ...entry('a'), later: 1 }] };
    expect(copiedList({ workflowId: 'a', triggers }, all)).toEqual([entry('a')]);
  });
});
