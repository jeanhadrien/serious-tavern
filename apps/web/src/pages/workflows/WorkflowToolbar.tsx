import { SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { EditorHeader } from '../../components/EditorHeader.js';

export function WorkflowToolbar({
  name,
  onNameChange,
  dirty,
  settingsOpen,
  settingsIssues,
  onToggleSettings,
  issueCount,
  issuesOpen,
  onToggleIssues,
  onValidate,
  onDuplicate,
  onSave,
  onRevert,
}: {
  name: string;
  onNameChange: (name: string) => void;
  dirty: boolean;
  settingsOpen: boolean;
  /** Problems in the chat settings declarations, shown as a count on the toggle. */
  settingsIssues: number;
  onToggleSettings: () => void;
  /** The engine's problems with the draft that the canvas list shows. */
  issueCount: number;
  issuesOpen: boolean;
  onToggleIssues: () => void;
  onValidate: () => void;
  onDuplicate: () => void;
  onSave: () => void;
  onRevert: () => void;
}) {
  return (
    <EditorHeader
      title={<input aria-label="Workflow name" value={name} onChange={(e) => onNameChange(e.target.value)} />}
      dirty={dirty}
      extra={
        <>
          {/* On a phone only the icon shows (settingsPanel.css), so the name comes from aria-label. */}
          <button
            type="button"
            className="toolbar-toggle"
            aria-pressed={settingsOpen}
            aria-label={settingsIssues > 0 ? `Chat settings (${settingsIssues} problem(s))` : 'Chat settings'}
            title="Chat settings"
            onClick={onToggleSettings}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span className="toolbar-toggle-label">Chat settings</span>
            {settingsIssues > 0 && (
              <span className="issue-count" aria-hidden="true">
                {settingsIssues}
              </span>
            )}
          </button>
          <button
            type="button"
            className="toolbar-toggle"
            aria-pressed={issuesOpen}
            aria-label={issueCount > 0 ? `Problems (${issueCount})` : 'Problems'}
            title="Problems"
            onClick={onToggleIssues}
          >
            <TriangleAlert size={16} aria-hidden="true" />
            <span className="toolbar-toggle-label">Problems</span>
            {issueCount > 0 && (
              <span className="issue-count" aria-hidden="true">
                {issueCount}
              </span>
            )}
          </button>
          <button type="button" onClick={onValidate}>
            Validate
          </button>
        </>
      }
      actions={{
        save: { onClick: onSave },
        revert: { onClick: onRevert },
        duplicate: { onClick: onDuplicate },
      }}
    />
  );
}
