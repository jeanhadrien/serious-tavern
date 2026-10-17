import { describe, expect, it } from 'vitest';
import { afterEdit, afterKeepName, afterSave, freshNameState } from './nameState.js';
import type { SaveOutcome } from './stateDefinitionActions.js';

const inUse: SaveOutcome = {
  kind: 'in-use',
  message: 'Chats store state under it',
  sessions: [{ id: 's1', title: 'Chat one' }],
};

describe('a refused rename (409 in use)', () => {
  it('locks the name and keeps the name the user tried, with the chats to show', () => {
    expect(afterSave(freshNameState, inUse, 'scene2')).toEqual({
      locked: true,
      blocked: { name: 'scene2', message: 'Chats store state under it', sessions: [{ id: 's1', title: 'Chat one' }] },
    });
  });

  it('keeps the lock when the banner is dismissed with "Keep the current name"', () => {
    const blocked = afterSave(freshNameState, inUse, 'scene2');
    expect(afterKeepName(blocked)).toEqual({ locked: true });
  });

  it('stays locked through later edits', () => {
    const blocked = afterSave(freshNameState, inUse, 'scene2');
    expect(afterEdit(blocked).locked).toBe(true);
    expect(afterEdit(blocked).blocked).toBe(blocked.blocked);
  });
});

describe('a taken name (409 name taken)', () => {
  const taken = afterSave(freshNameState, { kind: 'name-taken', message: 'That name is taken' }, 'other');

  it('shows the answer until the next edit', () => {
    expect(taken).toEqual({ locked: false, taken: 'That name is taken' });
    expect(afterEdit(taken)).toEqual({ locked: false });
  });

  it('does not lock the name', () => {
    expect(taken.locked).toBe(false);
  });
});

it('changes nothing for a save that went through or failed in another way', () => {
  const state = { locked: true, taken: 'x' };
  expect(afterSave(state, { kind: 'failed' }, 'a')).toBe(state);
  expect(afterSave(state, { kind: 'saved', definition: {} as never }, 'a')).toBe(state);
});

it('returns the same state when there is nothing to clear', () => {
  expect(afterEdit(freshNameState)).toBe(freshNameState);
  expect(afterKeepName(freshNameState)).toBe(freshNameState);
});
