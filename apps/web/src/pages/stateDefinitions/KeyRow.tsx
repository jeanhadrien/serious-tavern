import { X } from 'lucide-react';
import { stateKeyTypes, type StateKeyType } from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { changeKeyType, type KeyDraft } from './definitionDraft.js';
import { KeyTypeFields } from './KeyTypeFields.js';

interface KeyRowProps {
  keyDraft: KeyDraft;
  /** 1-based, for accessible names. */
  position: number;
  problems: readonly string[];
  onChange(uid: string, key: KeyDraft): void;
  onRemove(uid: string): void;
}

/** One key of the definition: its name and type, the fields of that type, and what is wrong with it. */
export function KeyRow({ keyDraft: key, position, problems, onChange, onRemove }: KeyRowProps) {
  return (
    <li className="state-key">
      <div className="state-key-head">
        <input
          aria-label={`Name of key ${position}`}
          value={key.name}
          placeholder="key_name"
          spellCheck={false}
          aria-invalid={problems.length > 0 || undefined}
          onChange={(event) => onChange(key.uid, { ...key, name: event.target.value })}
        />
        <select
          aria-label={`Type of key ${position}`}
          value={key.type}
          onChange={(event) => onChange(key.uid, changeKeyType(key, event.target.value as StateKeyType))}
        >
          {stateKeyTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <IconButton icon={X} label={`Remove key ${position}`} onClick={() => onRemove(key.uid)} />
      </div>
      <label>
        Description
        <input
          aria-label={`Description of key ${position}`}
          value={key.description}
          placeholder="Optional. What the key is for; the model sees it when it reads or writes this key"
          onChange={(event) => onChange(key.uid, { ...key, description: event.target.value })}
        />
      </label>
      <KeyTypeFields keyDraft={key} position={position} onChange={(patch) => onChange(key.uid, { ...key, ...patch })} />
      {problems.length > 0 && (
        <ul className="error state-key-problems" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
