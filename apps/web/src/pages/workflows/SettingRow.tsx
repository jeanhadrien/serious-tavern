import { useId, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import {
  settingLabel,
  workflowSettingTypes,
  type SettingDeclarationIssue,
  type WorkflowSetting,
  type WorkflowSettingType,
} from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { DraftNumberInput } from './DraftNumberInput.js';
import { optionsText, parseOptions, withType } from './settingsDraft.js';

type Field = NonNullable<SettingDeclarationIssue['field']>;
/** A field's problems next to it, and the `aria-describedby` that ties them to its control. */
type Problems = { show(field: Field): ReactNode; describedBy(field: Field): string | undefined };

/** One chat setting declaration in the workflow editor, with its problems next to the fields they concern. */
export function SettingRow({
  setting,
  first,
  last,
  issues,
  onChange,
  onMove,
  onRemove,
}: {
  setting: WorkflowSetting;
  first: boolean;
  last: boolean;
  issues: readonly SettingDeclarationIssue[];
  onChange(setting: WorkflowSetting): void;
  onMove(delta: -1 | 1): void;
  onRemove(): void;
}) {
  const name = settingLabel(setting) || 'setting';
  const base = useId();
  // Not live regions: most messages name the key, so each keystroke would announce them again.
  const ofField = (field: Field) => issues.filter((issue) => issue.field === field);
  const problems: Problems = {
    show: (field) =>
      ofField(field).map((issue, i) => (
        <p key={issue.message} id={`${base}-${field}-${i}`} className="error">
          {issue.message}
        </p>
      )),
    describedBy: (field) =>
      ofField(field)
        .map((_, i) => `${base}-${field}-${i}`)
        .join(' ') || undefined,
  };
  const text = (field: 'label' | 'description', value: string) => {
    const next = { ...setting, [field]: value };
    if (!value) delete next[field];
    onChange(next);
  };
  return (
    <fieldset className="setting-row">
      <div className="setting-row-head">
        <label>
          Key
          <input
            value={setting.key}
            spellCheck={false}
            aria-describedby={problems.describedBy('key')}
            onChange={(e) => onChange({ ...setting, key: e.target.value })}
          />
        </label>
        <span className="setting-row-actions">
          <IconButton icon={ArrowUp} label={`Move ${name} up`} disabled={first} onClick={() => onMove(-1)} />
          <IconButton icon={ArrowDown} label={`Move ${name} down`} disabled={last} onClick={() => onMove(1)} />
          <IconButton icon={Trash2} label={`Remove ${name}`} className="delete-button" onClick={onRemove} />
        </span>
      </div>
      {problems.show('key')}
      {problems.show('type')}
      <div className="setting-pair">
        <label>
          Type
          <select
            value={setting.type}
            onChange={(e) => onChange(withType(setting, e.target.value as WorkflowSettingType))}
          >
            {workflowSettingTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Label
          <input
            value={setting.label ?? ''}
            placeholder={setting.key}
            onChange={(e) => text('label', e.target.value)}
          />
        </label>
      </div>
      <TypeFields setting={setting} onChange={onChange} problems={problems} />
      <label>
        Description
        <input value={setting.description ?? ''} onChange={(e) => text('description', e.target.value)} />
      </label>
    </fieldset>
  );
}

function TypeFields({
  setting,
  onChange,
  problems,
}: {
  setting: WorkflowSetting;
  onChange(setting: WorkflowSetting): void;
  problems: Problems;
}) {
  switch (setting.type) {
    case 'number': {
      const bound = (field: 'min' | 'max' | 'step', value: number | undefined) => {
        const next = { ...setting, [field]: value };
        if (value === undefined) delete next[field];
        onChange(next);
      };
      // min > max is reported on min; it concerns max as well.
      const boundProblem = { min: 'min', max: 'min', step: 'step' } as const;
      return (
        <>
          <label>
            Default
            <DraftNumberInput
              value={setting.default}
              aria-describedby={problems.describedBy('default')}
              onChange={(value) => onChange({ ...setting, default: value ?? setting.default })}
            />
          </label>
          {problems.show('default')}
          <div className="setting-bounds">
            {(['min', 'max', 'step'] as const).map((field) => (
              <label key={field}>
                {field[0]!.toUpperCase() + field.slice(1)}
                <DraftNumberInput
                  value={setting[field]}
                  optional
                  aria-describedby={problems.describedBy(boundProblem[field])}
                  onChange={(value) => bound(field, value)}
                />
              </label>
            ))}
          </div>
          {problems.show('min')}
          {problems.show('step')}
        </>
      );
    }
    case 'boolean':
      return (
        <label className="check">
          <input
            type="checkbox"
            checked={setting.default}
            onChange={(e) => onChange({ ...setting, default: e.target.checked })}
          />
          On by default
        </label>
      );
    case 'enum':
      return <EnumFields setting={setting} onChange={onChange} problems={problems} />;
    case 'text':
      return (
        <>
          <label>
            Default
            {setting.multiline ? (
              <textarea
                rows={3}
                value={setting.default}
                onChange={(e) => onChange({ ...setting, default: e.target.value })}
              />
            ) : (
              <input value={setting.default} onChange={(e) => onChange({ ...setting, default: e.target.value })} />
            )}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={setting.multiline === true}
              onChange={(e) => onChange({ ...setting, multiline: e.target.checked })}
            />
            Several lines
          </label>
        </>
      );
  }
}

function EnumFields({
  setting,
  onChange,
  problems,
}: {
  setting: Extract<WorkflowSetting, { type: 'enum' }>;
  onChange(setting: WorkflowSetting): void;
  problems: Problems;
}) {
  // The textarea keeps what was typed (a trailing newline, a blank line) until the parsed options change.
  const [draft, setDraft] = useState(() => optionsText(setting.options));
  const shown =
    optionsText(parseOptions(draft)) === optionsText(setting.options) ? draft : optionsText(setting.options);
  return (
    <>
      <label>
        Options (one per line)
        <textarea
          rows={3}
          value={shown}
          aria-describedby={problems.describedBy('options')}
          onChange={(e) => {
            setDraft(e.target.value);
            onChange({ ...setting, options: parseOptions(e.target.value) });
          }}
        />
      </label>
      {problems.show('options')}
      <label>
        Default
        <select
          value={setting.default ?? ''}
          aria-describedby={problems.describedBy('default')}
          onChange={(e) => {
            const { default: _previous, ...rest } = setting;
            onChange(e.target.value ? { ...rest, default: e.target.value } : rest);
          }}
        >
          <option value="">(first option)</option>
          {setting.default !== undefined && !setting.options.includes(setting.default) && (
            <option value={setting.default}>{setting.default}</option>
          )}
          {setting.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      {problems.show('default')}
    </>
  );
}
