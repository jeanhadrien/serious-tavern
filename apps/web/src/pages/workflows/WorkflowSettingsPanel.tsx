import { Plus, X } from 'lucide-react';
import { workflowSettingIssues, type WorkflowSetting } from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { SettingRow } from './SettingRow.js';
import { moveSetting, newSetting, removeSetting } from './settingsDraft.js';
import './settingsPanel.css';

/**
 * The open workflow's chat settings: knobs every chat using it shows in its chat panel. They are part of the
 * workflow draft (saved with it); problems are shown as they are typed, the same ones a turn would report.
 */
export function WorkflowSettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: readonly WorkflowSetting[];
  onChange(settings: WorkflowSetting[]): void;
  onClose(): void;
}) {
  const issues = workflowSettingIssues(settings);
  const update = (index: number, setting: WorkflowSetting) =>
    onChange(settings.map((item, i) => (i === index ? setting : item)));
  return (
    <aside className="config-panel settings-panel" aria-label="Chat settings">
      <div className="toolbar">
        <h3>Chat settings</h3>
        <IconButton icon={X} label="Close chat settings" onClick={onClose} />
      </div>
      <p className="hint">
        Knobs every chat using this workflow shows in its chat panel. Templates read them as{' '}
        <code>{'{{settings.key}}'}</code>; the Chat Settings node outputs them.
      </p>
      {settings.length === 0 && <p className="hint">No chat settings yet.</p>}
      {settings.map((setting, index) => (
        <SettingRow
          // Rows have no id of their own; the position is what moves and removals change.
          key={index}
          setting={setting}
          first={index === 0}
          last={index === settings.length - 1}
          issues={issues.filter((issue) => issue.index === index)}
          onChange={(next) => update(index, next)}
          onMove={(delta) => onChange(moveSetting(settings, index, delta))}
          onRemove={() => onChange(removeSetting(settings, index))}
        />
      ))}
      <button type="button" className="setting-add" onClick={() => onChange([...settings, newSetting(settings)])}>
        <Plus size={16} aria-hidden="true" /> Add setting
      </button>
    </aside>
  );
}
