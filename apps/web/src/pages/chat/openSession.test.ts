import { describe, expect, it } from 'vitest';
import type { ChatMessage, Session } from '@st/shared';
import { withStoredMetadata, withStoredSettings } from './openSession.js';

const message = (id: string, content: string, status?: 'streaming'): ChatMessage => ({
  id,
  role: 'assistant',
  content,
  createdAt: '',
  ...(status ? { status } : {}),
});
const session = (changes: Partial<Session> = {}): Session => ({
  id: 's1',
  title: 'Chat',
  workflowId: 'w1',
  messages: [],
  createdAt: '',
  updatedAt: '',
  ...changes,
});

describe('a settings answer', () => {
  // Mid-turn: the local rows stream, the stored session doesn't have them yet.
  const local = session({ messages: [message('m1', 'Hel', 'streaming')], settings: { mood: 'calm' } });

  it('changes only the settings of the open chat, keeping streaming rows', () => {
    const stored = session({ title: 'Renamed', messages: [], settings: { mood: 'tense' } });
    expect(withStoredSettings(local, stored)).toEqual({ ...local, settings: { mood: 'tense' } });
  });

  it('clears the settings when the stored session has none', () => {
    expect(withStoredSettings(local, session())).toEqual(session({ messages: local.messages }));
  });

  it('leaves another chat alone, and no open chat', () => {
    expect(withStoredSettings(local, session({ id: 's2', settings: {} }))).toBe(local);
    expect(withStoredSettings(undefined, session())).toBeUndefined();
  });
});

describe('a metadata answer', () => {
  it('takes the stored metadata but keeps local messages and settings', () => {
    const local = session({ messages: [message('m1', 'Hi', 'streaming')], settings: { mood: 'tense' } });
    // Handled before a later settings save: its settings are outdated.
    const stored = session({ workflowId: 'w2', characterId: 'c1', settings: { mood: 'calm' } });
    expect(withStoredMetadata(local, stored)).toEqual({
      ...stored,
      messages: local.messages,
      settings: { mood: 'tense' },
    });
    expect(withStoredMetadata(session(), stored)).toEqual({ ...session({ workflowId: 'w2', characterId: 'c1' }) });
    expect(withStoredMetadata(local, session({ id: 's2' }))).toBe(local);
  });
});
