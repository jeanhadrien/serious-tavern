import { registry, type ExecutionFailure } from '@st/engine';
import type { TurnStop } from './turns.js';

const reasons: Record<TurnStop, string> = {
  user: 'was stopped by the user before it finished.',
  disconnect: 'ended because the client disconnected before it finished.',
  shutdown: 'ended because the server shut down before it finished.',
};

/** The execution warning for a run that was stopped: `subject` is the turn's reply section or one of its runs after the reply. */
export function stopWarning(subject: 'turn' | 'run after the reply', by: TurnStop): string {
  return `The ${subject} ${reasons[by]}`;
}

/** What a failed run says went wrong: the failing node's label and id with its error, else the plain message. */
export function failureMessage(failure: ExecutionFailure): string {
  const failedId = failure.nodeId;
  const label = failure.nodeType && registry.get(failure.nodeType)?.label;
  return label && failedId
    ? `${label} (${failedId}): ${failure.execution.nodes[failedId]?.error ?? failure.message}`
    : failure.message;
}
