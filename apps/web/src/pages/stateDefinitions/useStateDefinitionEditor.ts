import { useEffect, useMemo, useRef, useState } from 'react';
import { isSettingKey, type StateDefinition } from '@st/shared';
import { alerts } from '../../alerts/index.js';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { stateDefinitionEditorStore, stateDefinitionsStore, useEditorCommands, useList } from '../../stores/index.js';
import { startFileLiveSync } from '../fileLiveSync.js';
import { compile } from './definitionCompile.js';
import { classifyDefinitionChange, draftChanged, toDraft, type DefinitionDraft } from './definitionDraft.js';
import type { BlockedRename } from './StateDefinitionEditor.js';
import {
  createStateDefinitionFrom,
  deleteStateDefinition,
  saveStateDefinition,
  uniqueName,
} from './stateDefinitionActions.js';

const STATE_DEFINITIONS = {
  event: 'stateDefinitions.changed',
  noun: 'state definition',
  removedHint: 'Saving will fail; create a new definition and copy your changes into it.',
} as const;

/** The saved definition as a write body, with another name (the Duplicate flows). */
function copyOf({ id: _id, createdAt: _created, updatedAt: _updated, ...fields }: StateDefinition, name: string) {
  return { ...structuredClone(fields), name };
}

/**
 * The open definition and its draft. The editor stays mounted while hidden, so the draft survives the back arrow.
 * The list opens definitions through `stateDefinitionEditorStore`; edits made on disk reload a clean draft and
 * never replace a dirty one.
 */
export function useStateDefinitionEditor() {
  const { closeEditor } = useLayoutActions();
  const [definition, setDefinition] = useState<StateDefinition>();
  const [draft, setDraft] = useState<DefinitionDraft>();
  // The server refused a rename because chats hold state under the name: the name stays read-only while the
  // definition is open, and the banner offers the ways forward.
  const [nameLocked, setNameLocked] = useState(false);
  const [blocked, setBlocked] = useState<BlockedRename>();
  const [nameTaken, setNameTaken] = useState<string>();
  // True while a save is in flight: a second click must not send another.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const dirty = !!definition && !!draft && draftChanged(draft, definition);

  const definitions = useList(stateDefinitionsStore);
  const otherNames = useMemo(
    () => definitions.filter((item) => item.id !== definition?.id).map((item) => item.name),
    [definitions, definition?.id],
  );
  const problems = useMemo(
    () => compile(draft ?? { name: '', description: '', keys: [] }, otherNames).problems,
    [draft, otherNames],
  );

  const open = (item: StateDefinition) => {
    setDefinition(item);
    setDraft(toDraft(item));
    setNameLocked(false);
    setBlocked(undefined);
    setNameTaken(undefined);
  };
  const clear = () => {
    setDefinition(undefined);
    setDraft(undefined);
    setBlocked(undefined);
    setNameTaken(undefined);
  };

  const openId = definition?.id;
  useEffect(() => stateDefinitionEditorStore.report(openId, dirty), [openId, dirty]);
  useEditorCommands(stateDefinitionEditorStore, {
    open,
    close: (id) => {
      if (definition?.id === id) clear();
    },
  });

  const latest = useRef({ definition, draft });
  latest.current = { definition, draft };
  // The definition this editor deleted (or is deleting). Writes are announced before their response arrives,
  // so the sync must not report the editor's own delete as "removed from disk". Ids are never reused, so it is
  // not reset after a successful delete.
  const deleting = useRef<string>(undefined);
  useEffect(
    () =>
      startFileLiveSync<StateDefinition>(STATE_DEFINITIONS, () => {
        const editor = latest.current;
        const baseline = editor.definition ? JSON.stringify(toDraft(editor.definition)) : '';
        return {
          signature: () => [editor.definition?.id ?? '', deleting.current ?? '', baseline].join('\n'),
          refresh: () => stateDefinitionsStore.refresh(),
          classify: (fresh) =>
            classifyDefinitionChange({ ...editor, deleting: deleting.current === editor.definition?.id }, fresh),
          openName: () => editor.definition?.name ?? '',
          onReload: open,
          onClose: () => {
            clear();
            closeEditor('stateDefinitions');
          },
        };
      }),
    [],
  );

  const change = (next: DefinitionDraft) => {
    setDraft(next);
    setNameTaken(undefined);
  };
  const save = async () => {
    if (!definition || !draft || savingRef.current || problems.count) return;
    const { body } = compile(draft, otherNames);
    if (!body) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const outcome = await saveStateDefinition(definition.id, body);
      if (outcome.kind === 'saved') open(outcome.definition);
      else if (outcome.kind === 'name-taken') setNameTaken(outcome.message);
      else if (outcome.kind === 'in-use') {
        setBlocked({ name: body.name, message: outcome.message, sessions: outcome.sessions });
        setNameLocked(true);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  /** Copies the saved definition (not an unsaved draft) under a name the user picks. */
  const duplicate = async () => {
    if (!definition) return;
    const names = definitions.map((item) => item.name);
    const asked = window.prompt('Name of the copy', uniqueName(`${definition.name}_copy`, names));
    if (asked === null) return;
    const name = asked.trim();
    if (!isSettingKey(name) || names.some((taken) => taken.toLowerCase() === name.toLowerCase())) {
      alerts.warning(`"${name}" can't be used: it is invalid or another definition has that name.`);
      return;
    }
    const copy = await createStateDefinitionFrom(copyOf(definition, name));
    if (copy) open(copy);
  };
  /** After a refused rename: the whole draft (keys included) becomes a new definition with the attempted name. */
  const duplicateAs = async () => {
    const { body } = draft ? compile(draft, otherNames) : {};
    if (!body) return;
    const copy = await createStateDefinitionFrom(body);
    if (copy) open(copy); // the old definition is untouched on disk
  };
  const keepName = () => {
    if (!definition || !draft) return;
    setDraft({ ...draft, name: definition.name });
    setBlocked(undefined);
  };
  const remove = async () => {
    if (!definition || !window.confirm(`Delete state definition "${definition.name}"?`)) return;
    deleting.current = definition.id;
    if (!(await deleteStateDefinition(definition))) {
      deleting.current = undefined;
      return;
    }
    clear();
    closeEditor('stateDefinitions');
  };
  return {
    draft,
    dirty,
    problems,
    nameLocked,
    nameTaken,
    blocked,
    saving,
    change,
    save,
    duplicate,
    duplicateAs,
    keepName,
    remove,
    back: () => closeEditor('stateDefinitions'),
  };
}
