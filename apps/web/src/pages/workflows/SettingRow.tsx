import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import {
  settingLabel,
  workflowSettingTypes,
  type SettingDeclarationIssue,
  type WorkflowSetting,
  type WorkflowSettingType,
} from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { optionalNumber, optionsText, parseOptions, withType } from './settingsDraft.js';

type Field = NonNullable<SettingDeclarationIssue['field']>;

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
  const problems = (field: Field) =>
    issues
      .filter((issue) => issue.field === field)
      .map((issue) => (
        <p key={issue.message} className="error" role="alert">
          {issue.message}
        </p>
      ));
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
            onChange={(e) => onChange({ ...setting, key: e.target.value })}
          />
        </label>
        <span className="setting-row-actions">
          <IconButton icon={ArrowUp} label={`Move ${name} up`} disabled={first} onClick={() => onMove(-1)} />
          <IconButton icon={ArrowDown} label={`Move ${name} down`} disabled={last} onClick={() => onMove(1)} />
          <IconButton icon={Trash2} label={`Remove ${name}`} className="delete-button" onClick={onRemove} />
        </span>
      </div>
      {problems('key')}
      {problems('type')}
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
  problems(field: Field): ReactNode;
}) {
  switch (setting.type) {
    case 'number': {
      const bound = (field: 'min' | 'max' | 'step', value: string) => {
        const next = { ...setting, [field]: optionalNumber(value) };
        if (next[field] === undefined) delete next[field];
        onChange(next);
      };
      return (
        <>
          <label>
            Default
            <input
              type="number"
              value={String(setting.default)}
              onChange={(e) => onChange({ ...setting, default: Number(e.target.value) })}
            />
          </label>
          {problems('default')}
          <div className="setting-bounds">
            {(['min', 'max', 'step'] as const).map((field) => (
              <label key={field}>
                {field[0]!.toUpperCase() + field.slice(1)}
                <input type="number" value={setting[field] ?? ''} onChange={(e) => bound(field, e.target.value)} />
              </label>
            ))}
          </div>
          {problems('min')}
          {problems('step')}
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
  problems(field: Field): ReactNode;
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
          onChange={(e) => {
            setDraft(e.target.value);
            onChange({ ...setting, options: parseOptions(e.target.value) });
          }}
        />
      </label>
      {problems('options')}
      <label>
        Default
        <select
          value={setting.default ?? ''}
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
      {problems('default')}
    </>
  );
}
