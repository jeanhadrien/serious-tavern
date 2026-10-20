import { describe, expect, it } from 'vitest';
import type { ChatMessage, Session } from '@st/shared';
import { withStoredMetadata, withStoredSettings, withStoredTriggers } from './openSession.js';

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

describe('a reply list answer', () => {
  const entry = (workflowId: string, enabled = true) => ({ workflowId, enabled });
  const local = session({
    messages: [message('m1', 'Hel', 'streaming')],
    settings: { mood: 'calm' },
    triggers: { reply: [entry('w1')] },
  });

  it('takes only the list and the mirrored workflow id, keeping streaming rows and settings', () => {
    const stored = session({
      title: 'Renamed',
      workflowId: 'w2',
      settings: { mood: 'tense' },
      triggers: { reply: [entry('w2'), entry('w1', false)] },
    });
    expect(withStoredTriggers(local, stored)).toEqual({
      ...local,
      workflowId: 'w2',
      triggers: { reply: [entry('w2'), entry('w1', false)] },
    });
  });

  it('drops the local list when the stored session has none (an older chat reads as its workflow alone)', () => {
    const result = withStoredTriggers(local, session({ workflowId: 'w3' }));
    expect(result?.workflowId).toBe('w3');
    expect(result).not.toHaveProperty('triggers');
  });

  it('leaves another chat alone, and no open chat', () => {
    expect(withStoredTriggers(local, session({ id: 's2' }))).toBe(local);
    expect(withStoredTriggers(undefined, session())).toBeUndefined();
  });
});

describe('a metadata answer', () => {
  it('takes the stored metadata but keeps local messages, settings and reply list', () => {
    const local = session({
      messages: [message('m1', 'Hi', 'streaming')],
      settings: { mood: 'tense' },
      triggers: { reply: [{ workflowId: 'w1', enabled: false }] },
    });
    // Handled before a later settings or list save: its settings and list are outdated.
    const stored = session({
      workflowId: 'w2',
      characterId: 'c1',
      settings: { mood: 'calm' },
      triggers: { reply: [{ workflowId: 'w2', enabled: true }] },
    });
    expect(withStoredMetadata(local, stored)).toEqual({
      ...stored,
      workflowId: 'w1',
      messages: local.messages,
      settings: { mood: 'tense' },
      triggers: { reply: [{ workflowId: 'w1', enabled: false }] },
    });
    expect(withStoredMetadata(session(), stored)).toEqual(session({ characterId: 'c1' }));
    expect(withStoredMetadata(local, session({ id: 's2' }))).toBe(local);
  });
});
