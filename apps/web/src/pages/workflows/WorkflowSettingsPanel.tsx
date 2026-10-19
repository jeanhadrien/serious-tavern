import { Plus, Trash2, X } from 'lucide-react';
import { parseWorkflowSetting, settingLabel, workflowSettingIssues, type WorkflowSetting } from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { moveItem } from '../../components/sortable/moveItem.js';
import { SortableList, type SortableRow } from '../../components/sortable/SortableList.js';
import { useRowIds } from '../../components/sortable/useRowIds.js';
import { SettingRow } from './SettingRow.js';
import { draftList, newSetting, removeSetting } from './settingsDraft.js';
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
  // Declarations have no id of their own (and the stored value is kept raw): the ids live beside the list.
  const rows = useRowIds(list.length);
  const move = (from: number, to: number) => {
    rows.move(from, to);
    onChange(moveItem(list, from, to));
  };
  const remove = (index: number) => {
    rows.remove(index);
    onChange(removeSetting(list, index));
  };
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
      <SortableList
        className="sortable-contents"
        items={list}
        getId={(_, index) => rows.ids[index] as string}
        label={(item) => settingName(item)}
        onMove={move}
        renderItem={(item, row) => {
          const parsed = parseWorkflowSetting(item, row.index);
          return 'setting' in parsed ? (
            <SettingRow
              setting={parsed.setting}
              row={row}
              issues={issues.filter((issue) => issue.index === row.index)}
              onChange={(next) => update(row.index, next)}
              onRemove={() => remove(row.index)}
            />
          ) : (
            <InvalidSettingRow item={item} row={row} problem={parsed.problem} onRemove={() => remove(row.index)} />
          );
        }}
      />
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
  row,
  problem,
  onRemove,
}: {
  item: unknown;
  row: Pick<SortableRow, 'index' | 'handle'>;
  problem: string;
  onRemove(): void;
}) {
  const index = row.index;
  return (
    <fieldset className="setting-row setting-row-invalid">
      <div className="setting-row-head">
        <span>Chat setting #{index + 1} (read-only)</span>
        <span className="setting-row-actions">
          {row.handle}
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

/** A row's name for its drag handle: the setting's label or key, else its place (an unreadable one has no name). */
function settingName(item: unknown): string {
  const parsed = parseWorkflowSetting(item, 0);
  return ('setting' in parsed && settingLabel(parsed.setting)) || 'chat setting';
}
