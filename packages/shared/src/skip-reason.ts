import type { NodeSkip } from './models.js';

/**
 * The plain words for why a node was skipped (the chat's Execution details and the editor use this one). `nameOf` turns
 * the id in `by` into the node's name; without a name the sentence leaves the node out.
 */
export function skipReasonText(skip: NodeSkip, nameOf?: (nodeId: string) => string | undefined): string {
  switch (skip.reason) {
    case 'not-needed':
      return 'No output depends on it.';
    case 'inactive-inputs':
      return 'All its inputs come from branches that were not taken.';
    case 'source-skipped': {
      const source = skip.by === undefined ? undefined : nameOf?.(skip.by);
      return source === undefined
        ? 'A required input comes from a node that was skipped.'
        : `A required input comes from "${source}", which was skipped.`;
    }
  }
}
