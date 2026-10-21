import { describe, expect, it } from 'vitest';
import type { ChatMessage, ExecutionLog } from '@st/shared';
import {
  applyDelta,
  lastTurnReplyIds,
  messageLogId,
  replaceLastTurnReplies,
  resultLogs,
  settleRegenerate,
  settleTurn,
} from './turnMessages.js';

const user = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'user',
  content: 'hi',
  createdAt: '',
  ...extra,
});
const assistant = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  content: 'ok',
  createdAt: '',
  ...extra,
});

it('creates one streaming row per output and grows it with text and reasoning', () => {
  let messages = applyDelta([user('u')], { nodeId: 'out', reasoningDelta: 'think ' });
  messages = applyDelta(messages, { nodeId: 'out', textDelta: 'Hel' });
  messages = applyDelta(messages, { nodeId: 'other', textDelta: 'B' });
  messages = applyDelta(messages, { nodeId: 'out', textDelta: 'lo', reasoningDelta: 'more' });
  expect(messages).toHaveLength(3);
  expect(messages[1]).toMatchObject({ nodeId: 'out', status: 'streaming', content: 'Hello', reasoning: 'think more' });
  expect(messages[2]).toMatchObject({ nodeId: 'other', content: 'B' });
  expect(messages[2]?.reasoning).toBeUndefined();
});

it('clears the text of a row on reset, keeps its reasoning, and appends the delta that came with the reset', () => {
  let messages = applyDelta([user('u')], { nodeId: 'out', textDelta: 'Let me check', reasoningDelta: 'step 1' });
  messages = applyDelta(messages, { nodeId: 'out', reset: true, reasoningDelta: '\n\nstep 2' });
  expect(messages[1]).toMatchObject({ content: '', reasoning: 'step 1\n\nstep 2' });
  messages = applyDelta(messages, { nodeId: 'out', textDelta: 'The answer' });
  expect(messages[1]?.content).toBe('The answer');
  messages = applyDelta(messages, { nodeId: 'out', reset: true, textDelta: 'Restart' });
  expect(messages[1]?.content).toBe('Restart');
  expect(messages).toHaveLength(2);
});

it('keys a row by its run and node together: two workflows may use the same node id', () => {
  let messages = applyDelta([user('u')], { nodeId: 'out', runId: 'r1', textDelta: 'A' });
  messages = applyDelta(messages, { nodeId: 'out', runId: 'r2', textDelta: 'B' });
  messages = applyDelta(messages, { nodeId: 'out', runId: 'r1', textDelta: 'a' });
  messages = applyDelta(messages, { nodeId: 'out', runId: 'r2', textDelta: 'b' });
  expect(messages.slice(1).map((m) => [m.runId, m.content])).toEqual([
    ['r1', 'Aa'],
    ['r2', 'Bb'],
  ]);
});

it('opens a message log by its own run, else by the turn (older messages have no run id)', () => {
  expect(messageLogId({ runId: 'run', executionId: 'turn' })).toBe('run');
  expect(messageLogId({ executionId: 'turn' })).toBe('turn');
  expect(messageLogId({})).toBeUndefined();
});

it('collects the logs of every run of a result, and still reads a single-run one', () => {
  const log = (id: string): ExecutionLog => ({
    id,
    workflowId: 'w',
    sessionId: 's',
    status: 'completed',
    startedAt: '',
    nodes: {},
    warnings: [],
  });
  expect(resultLogs({ execution: log('a'), executions: [log('a'), log('b')] }).map((l) => l.id)).toEqual(['a', 'b']);
  // A failure: `execution` is the failing run's, `executions` may not list it.
  expect(resultLogs({ execution: log('b'), executions: [log('a')] }).map((l) => l.id)).toEqual(['a', 'b']);
  expect(resultLogs({ execution: log('a') }).map((l) => l.id)).toEqual(['a']);
});

it('settles a turn of several runs from the saved messages, whatever their order of streaming', () => {
  const live = [
    assistant('l1', { status: 'streaming', nodeId: 'out', runId: 'r1' }),
    assistant('l2', { status: 'streaming', nodeId: 'out', runId: 'r2' }),
  ];
  const saved = {
    userMessage: user('saved'),
    assistantMessages: [assistant('f1', { runId: 'r1' }), assistant('f2', { runId: 'r2' })],
  };
  expect(settleTurn([user('optimistic'), ...live], 'optimistic', saved).map((m) => m.id)).toEqual([
    'saved',
    'f1',
    'f2',
  ]);
});

it('settles a turn by replacing local rows with the saved ones and keeping older history', () => {
  const live = assistant('live', { status: 'streaming', nodeId: 'out' });
  const messages = [assistant('old', { status: 'partial' }), user('optimistic'), live];
  const saved = { userMessage: user('saved'), assistantMessages: [assistant('final', { status: 'final' })] };
  expect(settleTurn(messages, 'optimistic', saved).map((message) => message.id)).toEqual(['old', 'saved', 'final']);
});

it('settles an empty send, which has no user message, without adding one', () => {
  const messages = [user('old'), assistant('live', { status: 'streaming', nodeId: 'out' })];
  const saved = { assistantMessages: [assistant('final', { status: 'final' })] };
  expect(settleTurn(messages, undefined, saved).map((message) => message.id)).toEqual(['old', 'final']);
});

describe('regenerate bookkeeping', () => {
  const turn = [
    user('u', { executionId: 'e1' }),
    assistant('a1', { executionId: 'e1' }),
    assistant('a2', { executionId: 'e1' }),
  ];
  const ids = (messages: ChatMessage[]) => messages.map((message) => `${message.id}${message.inactive ? '*' : ''}`);

  it('finds the shown replies of the last turn, whichever alternative is shown', () => {
    expect(lastTurnReplyIds(turn)).toEqual(['a1', 'a2']);
    const swiped = [
      ...turn.map((message) => (message.role === 'assistant' ? { ...message, inactive: true as const } : message)),
      assistant('b1', { executionId: 'e2', alternativeOf: 'e1' }),
    ];
    expect(lastTurnReplyIds(swiped)).toEqual(['b1']);
  });

  it('has nothing to replace in an empty chat, after a user message or while a row streams', () => {
    expect(lastTurnReplyIds([])).toEqual([]);
    expect(lastTurnReplyIds([...turn, user('next')])).toEqual([]);
    expect(lastTurnReplyIds([user('u'), assistant('live', { status: 'streaming' })])).toEqual([]);
  });

  it('hides the replies without touching the user message or other rows', () => {
    const hidden = replaceLastTurnReplies(turn, ['a1', 'a2']);
    expect(ids(hidden)).toEqual(['u', 'a1*', 'a2*']);
    expect(hidden[0]).toBe(turn[0]);
    expect(replaceLastTurnReplies(turn, [])).toBe(turn);
  });

  it('keeps the old replies hidden and appends the new alternative when the run saved replies', () => {
    const live = assistant('live', { status: 'streaming', nodeId: 'out' });
    const hidden = [...replaceLastTurnReplies(turn, ['a1', 'a2']), live];
    const saved = { assistantMessages: [assistant('n1', { executionId: 'e2', alternativeOf: 'e1', status: 'final' })] };
    expect(ids(settleRegenerate(hidden, ['a1', 'a2'], saved))).toEqual(['u', 'a1*', 'a2*', 'n1']);
  });

  it('shows the old replies again when the run saved none', () => {
    const live = assistant('live', { status: 'streaming', nodeId: 'out' });
    const hidden = [...replaceLastTurnReplies(turn, ['a1', 'a2']), live];
    const settled = settleRegenerate(hidden, ['a1', 'a2'], { assistantMessages: [] });
    expect(ids(settled)).toEqual(['u', 'a1', 'a2']);
    expect('inactive' in settled[1]!).toBe(false);
  });

  it('leaves replies that were already inactive before the run alone', () => {
    const older = assistant('old', { executionId: 'e0', inactive: true });
    const settled = settleRegenerate([older, ...turn], ['a1'], { assistantMessages: [] });
    expect(ids(settled)).toEqual(['old*', 'u', 'a1', 'a2']);
  });
});
