import { Plus, Trash2, X } from 'lucide-react';
import { parseWorkflowSetting, workflowSettingIssues, type WorkflowSetting } from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { SettingRow } from './SettingRow.js';
import { draftList, moveSetting, newSetting, removeSetting } from './settingsDraft.js';
import './settingsPanel.css';

/**
 * The open workflow's chat settings: knobs every chat using it shows in its chat panel. They are part of the
 * workflow draft (saved with it); problems are shown as they are typed, the same ones a turn would report.
 * `settings` is the draft's raw value: a declaration that doesn't parse is shown read-only, never dropped.
 */
export function WorkflowSettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: unknown;
  onChange(settings: unknown[]): void;
  onClose(): void;
}) {
  const list = draftList(settings);
  const issues = workflowSettingIssues(settings);
  const notAList = issues.find((issue) => issue.index === -1);
  const update = (index: number, setting: WorkflowSetting) =>
    onChange(list.map((item, i) => (i === index ? setting : item)));
  return (
    <aside className="config-panel workflow-settings-panel" aria-label="Chat settings">
      <div className="toolbar">
        <h3>Chat settings</h3>
        <IconButton icon={X} label="Close chat settings" onClick={onClose} />
      </div>
      <p className="hint">
        Knobs every chat using this workflow shows in its chat panel. Templates read them as{' '}
        <code>{'{{settings.key}}'}</code>; the Chat Settings node outputs them.
      </p>
      {notAList ? (
        <>
          <p className="error">{notAList.message}</p>
          <button type="button" onClick={() => onChange([])}>
            Replace with an empty list
          </button>
        </>
      ) : (
        list.length === 0 && <p className="hint">No chat settings yet.</p>
      )}
      {list.map((item, index) => {
        const parsed = parseWorkflowSetting(item, index);
        const rowIssues = issues.filter((issue) => issue.index === index);
        return 'setting' in parsed ? (
          <SettingRow
            // Rows have no id of their own; the position is what moves and removals change.
            key={index}
            setting={parsed.setting}
            first={index === 0}
            last={index === list.length - 1}
            issues={rowIssues}
            onChange={(next) => update(index, next)}
            onMove={(delta) => onChange(moveSetting(list, index, delta))}
            onRemove={() => onChange(removeSetting(list, index))}
          />
        ) : (
          <InvalidSettingRow
            key={index}
            item={item}
            index={index}
            problem={parsed.problem}
            onRemove={() => onChange(removeSetting(list, index))}
          />
        );
      })}
      {!notAList && (
        <button type="button" className="setting-add" onClick={() => onChange([...list, newSetting(list)])}>
          <Plus size={16} aria-hidden="true" /> Add setting
        </button>
      )}
    </aside>
  );
}

/**
 * A stored declaration the editor can't read (a hand-edited typo, a type from a newer version). Like an
 * unknown node it is kept as it is; the user can only remove it, and the workflow won't save until then.
 */
function InvalidSettingRow({
  item,
  index,
  problem,
  onRemove,
}: {
  item: unknown;
  index: number;
  problem: string;
  onRemove(): void;
}) {
  return (
    <fieldset className="setting-row setting-row-invalid">
      <div className="setting-row-head">
        <span>Chat setting #{index + 1} (read-only)</span>
        <span className="setting-row-actions">
          <IconButton
            icon={Trash2}
            label={`Remove chat setting #${index + 1}`}
            className="delete-button"
            onClick={onRemove}
          />
        </span>
      </div>
      <p className="error">{problem}</p>
      <p className="hint">Remove it, or fix it in the workflow file, before saving this workflow.</p>
      <pre>{JSON.stringify(item, null, 2)}</pre>
    </fieldset>
  );
}
