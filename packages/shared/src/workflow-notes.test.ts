import { expect, it } from 'vitest';
import { workflowNotes } from './workflow-notes.js';

const note = { id: 'n', text: 'hi', position: { x: 1, y: 2 } };

it('reads the notes of a stored workflow, and nothing from a missing or malformed field', () => {
  expect(workflowNotes({ notes: [note] })).toEqual([note]);
  for (const notes of [undefined, null, 'x', 5, {}, { 0: note }]) expect(workflowNotes({ notes })).toEqual([]);
});

it('skips an item that is not a note and keeps the others, with fields it does not know', () => {
  const future = { ...note, id: 'f', colour: 'yellow' };
  expect(workflowNotes({ notes: [note, 'junk', { id: 'x' }, null, future] })).toEqual([note, future]);
});
