import { Link } from 'react-router-dom';
import { EditorHeader } from '../../components/EditorHeader.js';
import { layoutHref } from '../../layout/url.js';
import { newKeyDraft, type DefinitionDraft, type KeyDraft } from './definitionDraft.js';
import type { DraftProblems } from './definitionCompile.js';
import { KeyRow } from './KeyRow.js';
import type { BlockedRename } from './stateDefinitionActions.js';

interface StateDefinitionEditorProps {
  draft: DefinitionDraft;
  dirty: boolean;
  problems: DraftProblems;
  /** The name cannot be changed (the server said chats hold state under it). */
  nameLocked: boolean;
  /** The server's answer when another definition has the name. */
  nameTaken?: string;
  blocked?: BlockedRename;
  saving: boolean;
  onChange(draft: DefinitionDraft): void;
  onSave(): void;
  onRevert(): void;
  onDelete(): void;
  onDuplicate(): void;
  onDuplicateAs(): void;
  onKeepName(): void;
  onBack(): void;
}

/** The definition form shown in L in place of the state definitions list. */
export function StateDefinitionEditor(props: StateDefinitionEditorProps) {
  const { draft, dirty, problems, nameLocked, blocked, onChange } = props;
  const nameProblem = props.nameTaken ?? problems.name;
  const canSave = dirty && problems.count === 0 && !props.saving;
  const saveTitle = !dirty
    ? 'No changes to save'
    : problems.count
      ? 'Fix the problems shown in the form first'
      : undefined;
  const usage = `{{state.${draft.name || 'name'}.<key>}}`;
  const changeKey = (uid: string, key: KeyDraft) =>
    onChange({ ...draft, keys: draft.keys.map((item) => (item.uid === uid ? key : item)) });
  return (
    <section className="state-editor">
      <EditorHeader
        title={draft.name || 'State definition'}
        back={{ label: 'Back to state definitions', onClick: props.onBack }}
        dirty={dirty}
        actions={{
          save: { onClick: props.onSave, disabled: !canSave, title: saveTitle },
          revert: { onClick: props.onRevert },
          duplicate: {
            label: 'Duplicate…',
            onClick: props.onDuplicate,
            disabled: dirty,
            title: dirty ? 'Duplicate copies the saved definition: save or undo your changes first' : undefined,
          },
          remove: { onClick: props.onDelete },
        }}
      />
      {blocked && (
        <div className="state-banner" role="alert">
          <p>{blocked.message}</p>
          {blocked.sessions.length > 0 && (
            <ul>
              {blocked.sessions.map((session) => (
                <li key={session.id}>
                  <Link to={layoutHref({ session: session.id })}>{session.title}</Link>
                </li>
              ))}
            </ul>
          )}
          <div className="toolbar">
            <button
              type="button"
              disabled={problems.count > 0}
              title={problems.count ? 'Fix the problems shown in the form first' : undefined}
              onClick={props.onDuplicateAs}
            >
              Duplicate as "{blocked.name}"
            </button>
            <button type="button" onClick={props.onKeepName}>
              Keep the current name
            </button>
          </div>
        </div>
      )}
      <div className="state-form">
        <label>
          Name
          <input
            value={draft.name}
            readOnly={nameLocked}
            spellCheck={false}
            aria-invalid={nameProblem ? true : undefined}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
          <small>
            {nameLocked ? 'This name is locked: chats store state under it. ' : ''}
            Templates read it as <code>{usage}</code>.
          </small>
          {nameProblem && (
            <span className="error" role="alert">
              {nameProblem}
            </span>
          )}
        </label>
        <label>
          Description
          <textarea
            rows={2}
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
          />
        </label>
        <section className="state-keys" aria-label="Keys">
          <h2>Keys</h2>
          <p className="hint">
            Renaming a key does not move what chats stored under the old name: it is ignored (with a warning), and
            workflow nodes using it need to be pointed at the new name.
          </p>
          <ul>
            {draft.keys.map((key, index) => (
              <KeyRow
                key={key.uid}
                keyDraft={key}
                position={index + 1}
                problems={problems.keys[key.uid] ?? []}
                onChange={changeKey}
                onRemove={(uid) => onChange({ ...draft, keys: draft.keys.filter((item) => item.uid !== uid) })}
              />
            ))}
          </ul>
          {!draft.keys.length && <p className="hint">No keys yet.</p>}
          <button type="button" onClick={() => onChange({ ...draft, keys: [...draft.keys, newKeyDraft()] })}>
            + Add key
          </button>
        </section>
      </div>
    </section>
  );
}
