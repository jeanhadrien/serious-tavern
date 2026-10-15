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
      {/* On a phone only the icon shows (settingsPanel.css), so the name comes from aria-label. */}
      <button
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
      <button onClick={onValidate}>Validate</button>
      <button onClick={onDuplicate}>Duplicate</button>
      <button className="primary" onClick={onSave}>
        Save
      </button>
    </div>
  );
}
