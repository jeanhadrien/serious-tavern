import { SlidersHorizontal } from 'lucide-react';
import { EditorHeader } from '../../components/EditorHeader.js';

export function WorkflowToolbar({
  name,
  onNameChange,
  dirty,
  settingsOpen,
  settingsIssues,
  onToggleSettings,
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
