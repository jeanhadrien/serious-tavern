import { SlidersHorizontal } from 'lucide-react';

export function WorkflowToolbar({
  name,
  onNameChange,
  settingsOpen,
  settingsIssues,
  onToggleSettings,
  onValidate,
  onDuplicate,
  onSave,
}: {
  name: string;
  onNameChange: (name: string) => void;
  settingsOpen: boolean;
  /** Problems in the chat settings declarations, shown as a count on the toggle. */
  settingsIssues: number;
  onToggleSettings: () => void;
  onValidate: () => void;
  onDuplicate: () => void;
  onSave: () => void;
}) {
  return (
    <div className="editor-toolbar">
      <input aria-label="Workflow name" value={name} onChange={(e) => onNameChange(e.target.value)} />
      <button
        className="toolbar-toggle"
        aria-pressed={settingsOpen}
        title="Chat settings this workflow declares"
        onClick={onToggleSettings}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        Chat settings
        {settingsIssues > 0 && (
          <span className="issue-count" title={`${settingsIssues} problem(s)`}>
            {settingsIssues}
          </span>
        )}
      </button>
      <button onClick={onValidate}>Validate</button>
      <button onClick={onDuplicate}>Duplicate</button>
      <button className="primary" onClick={onSave}>
        Save
      </button>
    </div>
  );
}
