import { useId, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { settingLabel, type WorkflowSetting } from '@st/shared';
import { IconButton } from '../../../components/IconButton.js';
import { controlKind, parseNumberDraft } from './settingControls.js';

export type ChangeMode = 'now' | 'debounced';

/** One chat setting in the chat panel: its control, a reset when a value is stored, and the resolver's issue. */
export function SettingControl({
  setting,
  value,
  resettable,
  issue,
  onChange,
  onFlush,
  onReset,
}: {
  setting: WorkflowSetting;
  value: unknown;
  resettable: boolean;
  issue?: string;
  onChange(value: unknown, mode: ChangeMode): void;
  onFlush(): void;
  onReset(): void;
}) {
  const id = useId();
  const label = settingLabel(setting);
  const kind = controlKind(setting);
  const control = () => {
    switch (kind) {
      case 'slider':
        return (
          <div className="chat-setting-range">
            <input
              id={id}
              type="range"
              min={setting.type === 'number' ? setting.min : undefined}
              max={setting.type === 'number' ? setting.max : undefined}
              step={(setting.type === 'number' && setting.step) || 'any'}
              value={Number(value)}
              onChange={(event) => onChange(Number(event.target.value), 'debounced')}
              onPointerUp={onFlush}
              onBlur={onFlush}
            />
            <NumberField
              label={`${label} value`}
              setting={setting}
              value={value}
              onChange={onChange}
              onFlush={onFlush}
            />
          </div>
        );
      case 'number':
        return <NumberField id={id} setting={setting} value={value} onChange={onChange} onFlush={onFlush} />;
      case 'toggle':
        return (
          <input
            id={id}
            type="checkbox"
            className="chat-setting-toggle"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked, 'now')}
          />
        );
      case 'select':
        return (
          <select id={id} value={String(value)} onChange={(event) => onChange(event.target.value, 'now')}>
            {setting.type === 'enum' &&
              setting.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
          </select>
        );
      case 'textarea':
        return (
          <textarea
            id={id}
            rows={4}
            value={String(value ?? '')}
            onChange={(event) => onChange(event.target.value, 'debounced')}
            onBlur={onFlush}
          />
        );
      case 'text':
        return (
          <input
            id={id}
            value={String(value ?? '')}
            onChange={(event) => onChange(event.target.value, 'debounced')}
            onBlur={onFlush}
          />
        );
    }
  };
  return (
    <div className={`chat-setting chat-setting-${kind}`}>
      <div className="chat-setting-head">
        <label htmlFor={id}>{label}</label>
        {resettable && <IconButton icon={RotateCcw} label={`Reset ${label} to default`} onClick={onReset} />}
      </div>
      {control()}
      {setting.description && <p className="hint">{setting.description}</p>}
      {issue && <p className="hint warning">{issue}</p>}
    </div>
  );
}

/** A number typed as text: partial input ("-", "0.") stays editable, and only valid numbers are saved. */
function NumberField({
  id,
  label,
  setting,
  value,
  onChange,
  onFlush,
}: {
  id?: string;
  label?: string;
  setting: WorkflowSetting;
  value: unknown;
  onChange(value: unknown, mode: ChangeMode): void;
  onFlush(): void;
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const parsed = parseNumberDraft(text, setting);
  // While not typing, the field follows the value (the slider, a reset, another tab).
  const shown = editing || ('value' in parsed && parsed.value === value) ? text : String(value);
  return (
    <>
      <input
        id={id}
        aria-label={label}
        type="text"
        inputMode="decimal"
        value={shown}
        onFocus={() => {
          setText(shown);
          setEditing(true);
        }}
        onChange={(event) => {
          setText(event.target.value);
          const next = parseNumberDraft(event.target.value, setting);
          if ('value' in next) onChange(next.value, 'debounced');
        }}
        onBlur={() => {
          setEditing(false);
          onFlush();
        }}
      />
      {editing && 'problem' in parsed && <p className="error chat-setting-problem">{parsed.problem}</p>}
    </>
  );
}
