import { describe, expect, it } from 'vitest';
import type { NodeChange } from '@xyflow/react';
import type { Note, Workflow } from '@st/shared';
import { newNoteNode, noteNodesOf, notesOf, partitionChanges, startsResize } from './canvasNotes.js';
import { canvasToWorkflow } from './model.js';

const stored: Note[] = [
  { id: 'a', text: 'plain', position: { x: 1, y: 2 } },
  { id: 'b', text: 'sized', position: { x: 3, y: 4 }, size: { width: 220, height: 130 }, colour: 'yellow' },
];

describe('notes on the canvas', () => {
  it('round-trips stored notes, keeping a size and the fields it does not know', () => {
    const nodes = noteNodesOf(stored);
    expect(nodes[0]).toMatchObject({ id: 'a', type: 'note', data: { text: 'plain' } });
    expect(nodes[0]).not.toHaveProperty('width');
    expect(nodes[1]).toMatchObject({ width: 220, height: 130 });
    expect(notesOf(nodes)).toEqual(stored);
  });

  it('stores a size only once there is one, and never the view state', () => {
    const live = { ...newNoteNode('n', { x: 0, y: 0 }), selected: true, measured: { width: 200, height: 120 } };
    expect(notesOf([live])).toEqual([{ id: 'n', text: '', position: { x: 0, y: 0 } }]);
  });
});

describe('canvasToWorkflow with notes', () => {
  const workflow = { id: 'w', name: 'W', nodes: [], edges: [], createdAt: '', updatedAt: '' } as Workflow;
  it('writes the notes it is given, an empty list included', () => {
    expect(canvasToWorkflow(workflow, [], [], noteNodesOf(stored)).notes).toEqual(stored);
    expect(canvasToWorkflow({ ...workflow, notes: stored }, [], [], []).notes).toEqual([]);
    expect(canvasToWorkflow(workflow, [], [], []).notes).toEqual([]);
  });
  it('leaves the workflow own notes alone when none are given', () => {
    expect(canvasToWorkflow({ ...workflow, notes: stored }, [], []).notes).toEqual(stored);
    expect(canvasToWorkflow(workflow, [], [])).not.toHaveProperty('notes');
  });
});

describe('partitionChanges', () => {
  const position = (id: string): NodeChange => ({ type: 'position', id, position: { x: 1, y: 1 } });
  it('hands the note changes to the notes and the rest to the nodes, in order', () => {
    const changes = [
      position('node'),
      position('note'),
      { type: 'remove', id: 'note' } as NodeChange,
      position('other'),
    ];
    const { forNotes, rest } = partitionChanges(changes, new Set(['note']));
    expect(forNotes).toEqual([changes[1], changes[2]]);
    expect(rest).toEqual([changes[0], changes[3]]);
  });
  it('never takes a change without an id for a note', () => {
    const reset = { type: 'reset', item: {} } as unknown as NodeChange;
    expect(partitionChanges([reset], new Set(['note'])).rest).toEqual([reset]);
  });
});

describe('startsResize', () => {
  const dimensions = (resizing?: boolean): NodeChange => ({ type: 'dimensions', id: 'n', resizing });
  it.each([
    ['the first change of a resize', dimensions(true), false, true],
    ['the following changes', dimensions(true), true, false],
    ['the end of a resize', dimensions(false), true, false],
    ['a measurement', dimensions(undefined), false, false],
    ['a move', { type: 'position', id: 'n' } as NodeChange, false, false],
  ])('%s', (_, change, was, expected) => {
    expect(startsResize(change, was)).toBe(expected);
  });
});
