import { X } from 'lucide-react';
import type { ValidationIssue } from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { useEscapeLayer } from '../../keyboard/escapeRegistry.js';
import type { issueTargets } from './issueOverlay.js';
import './issueList.css';

type Targets = ReturnType<typeof issueTargets>;

/**
 * The engine's problems with the draft, over the canvas. An issue that names nodes or a connection is a button that
 * selects them and fits the view; one about the workflow as a whole (a loop, no output) is plain text.
 */
export function IssueList({
  entries,
  onPick,
  onClose,
}: {
  entries: { issue: ValidationIssue; targets: Targets }[];
  onPick: (targets: Targets) => void;
  onClose: () => void;
}) {
  useEscapeLayer(true, onClose);
  return (
    <section className="issue-list" aria-label="Problems">
      <header>
        <h3>Problems</h3>
        <IconButton icon={X} label="Close problems" onClick={onClose} />
      </header>
      {entries.length ? (
        <ul>
          {entries.map(({ issue, targets }, index) => (
            <li key={`${index}:${issue.message}`}>
              {targets.nodeIds.length || targets.edgeId ? (
                <button type="button" onClick={() => onPick(targets)}>
                  {issue.message}
                </button>
              ) : (
                <span>{issue.message}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">No problems found.</p>
      )}
    </section>
  );
}
