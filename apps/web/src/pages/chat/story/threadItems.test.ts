import { describe, expect, it } from 'vitest';
import { itemFields } from './format.js';
import { exchangeCount, isThreadSummaryField, threadNote, threadSummaryOf, toolNames } from './threadItems.js';

const summary = {
  id: 'a',
  text: 'hi',
  steps: 3,
  toolCalls: ['read_state', 'write_scene_mood'],
  turnId: 't',
  runId: 'r',
};

describe('threadSummaryOf', () => {
  it('reads the summary the view gives a thread item', () => {
    expect(threadSummaryOf(summary)).toEqual({ steps: 3, toolCalls: ['read_state', 'write_scene_mood'], runId: 'r' });
  });

  it('is undefined for any other item, a collection item with a field called steps included', () => {
    expect(threadSummaryOf({ id: 'a', text: 'hi' })).toBeUndefined();
    expect(threadSummaryOf({ id: 'a', text: 'hi', steps: 3 })).toBeUndefined();
    expect(threadSummaryOf({ id: 'a', text: 'hi', steps: '3', toolCalls: [] })).toBeUndefined();
  });

  it('has no run id when the item carries none, and skips anything but tool names', () => {
    expect(threadSummaryOf({ id: 'a', text: 'x', steps: 1, toolCalls: [] })).toEqual({ steps: 1, toolCalls: [] });
    expect(threadSummaryOf({ id: 'a', text: 'x', steps: 1, toolCalls: ['a', 3, null], runId: '' })).toEqual({
      steps: 1,
      toolCalls: ['a'],
    });
  });
});

describe('threadNote', () => {
  it.each([
    [{ steps: 1, toolCalls: [] }, 'no tool calls'],
    [{ steps: 2, toolCalls: ['a'] }, '1 tool call · 2 steps'],
    [{ steps: 4, toolCalls: ['a', 'b', 'a'] }, '3 tool calls · 4 steps'],
    [{ steps: 1, toolCalls: ['a'] }, '1 tool call'],
    // A stored item that says zero steps is still worded sensibly.
    [{ steps: 0, toolCalls: [] }, 'no tool calls'],
  ])('words %j as %s', (thread, expected) => {
    expect(threadNote(thread)).toBe(expected);
  });

  it('lists the tool names in call order, and the exchanges as a count', () => {
    expect(toolNames({ steps: 3, toolCalls: ['a', 'b', 'a'] })).toBe('a, b, a');
    expect(toolNames({ steps: 1, toolCalls: [] })).toBe('');
    expect([1, 2, 0].map(exchangeCount)).toEqual(['1 exchange', '2 exchanges', '0 exchanges']);
  });
});

describe('the summary is not an item field', () => {
  it('leaves steps, tool calls and the ids out of a thread item, and keeps them on other items', () => {
    expect(itemFields(summary)).toEqual([]);
    expect(isThreadSummaryField(summary, 'steps')).toBe(true);
    expect(isThreadSummaryField(summary, 'mood')).toBe(false);
    // A declared field with the same name on a collection item is still listed.
    expect(itemFields({ id: 'a', text: 'x', steps: 3 })).toEqual([{ name: 'steps', value: '3' }]);
    expect(isThreadSummaryField({ id: 'a', text: 'x', steps: 3 }, 'steps')).toBe(false);
  });
});
