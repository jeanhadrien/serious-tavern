import { describe, expect, it } from 'vitest';
import { ExecutionFailure } from '@st/engine';
import type { ExecutionLog } from '@st/shared';
import { failureMessage, stopWarning } from './failure.js';

describe('stopWarning', () => {
  it.each([
    ['turn', 'user', 'The turn was stopped by the user before it finished.'],
    ['turn', 'disconnect', 'The turn ended because the client disconnected before it finished.'],
    ['turn', 'shutdown', 'The turn ended because the server shut down before it finished.'],
    ['run after the reply', 'user', 'The run after the reply was stopped by the user before it finished.'],
    [
      'run after the reply',
      'shutdown',
      'The run after the reply ended because the server shut down before it finished.',
    ],
  ] as const)('says how the %s ended when stopped by %s', (subject, by, expected) => {
    expect(stopWarning(subject, by)).toBe(expected);
  });
});

describe('failureMessage', () => {
  const log = (nodes: ExecutionLog['nodes']): ExecutionLog => ({
    id: 'e1',
    workflowId: 'w',
    sessionId: 's',
    status: 'error',
    startedAt: '',
    nodes,
    warnings: [],
  });

  it('names the failing node by label and id and gives the node’s own error', () => {
    const execution = log({ parse: { status: 'error', error: 'Unexpected token' } });
    const failure = new ExecutionFailure('Node failed', execution, [], 'parse', 'parse-json');
    expect(failureMessage(failure)).toBe('Parse JSON (parse): Unexpected token');
  });

  it('falls back to the failure’s message without a node or for an unknown type', () => {
    expect(failureMessage(new ExecutionFailure('Run failed', log({})))).toBe('Run failed');
    expect(failureMessage(new ExecutionFailure('Gone', log({}), [], 'x', 'no-such-type'))).toBe('Gone');
  });

  it('uses the failure’s message when the node has no recorded error', () => {
    const failure = new ExecutionFailure('Aborted', log({ parse: { status: 'cancelled' } }), [], 'parse', 'parse-json');
    expect(failureMessage(failure)).toBe('Parse JSON (parse): Aborted');
  });
});
