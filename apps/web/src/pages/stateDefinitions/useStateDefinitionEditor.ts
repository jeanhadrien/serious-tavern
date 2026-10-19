import { useEffect, useMemo, useRef, useState } from 'react';
import type { StateDefinition } from '@st/shared';
import { alerts } from '../../alerts/index.js';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import {
  stateDefinitionEditorStore,
  stateDefinitionsStore,
  useEditorCommands,
  useEditorSaver,
  useList,
} from '../../stores/index.js';
import { useFileSync } from '../useFileSync.js';
import { compile, definitionNameProblem } from './definitionCompile.js';
import { afterEdit, afterKeepName, afterSave, freshNameState } from './nameState.js';
import { classifyDefinitionChange, draftChanged, toDraft, type DefinitionDraft } from './definitionDraft.js';
import {
  createStateDefinitionFrom,
  deleteStateDefinition,
  saveStateDefinition,
  uniqueName,
} from './stateDefinitionActions.js';
import { confirmDelete } from '../../components/dialog/dialogStore.js';

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
  // The server's answers about the name (a refused rename locks it while the definition is open).
  const [names, setNames] = useState(freshNameState);
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
    setNames(freshNameState);
  };
  const clear = () => {
    setDefinition(undefined);
    setDraft(undefined);
    setNames(freshNameState);
  };

  const openId = definition?.id;
  useEffect(() => stateDefinitionEditorStore.report(openId, dirty), [openId, dirty]);
  useEditorCommands(stateDefinitionEditorStore, {
    open,
    close: (id) => {
      if (definition?.id === id) clear();
    },
  });

  const deleting = useFileSync<StateDefinition, DefinitionDraft>({
    resource: STATE_DEFINITIONS,
    item: definition,
    draft,
    baseline: (item) => JSON.stringify(toDraft(item)),
    refresh: () => stateDefinitionsStore.refresh(),
    classify: ({ item, draft: current, deleting: own }, fresh) =>
      classifyDefinitionChange({ definition: item, draft: current, deleting: own }, fresh),
    onReload: open,
    onClose: () => {
      clear();
      closeEditor('stateDefinitions');
    },
  });

  const change = (next: DefinitionDraft) => {
    setDraft(next);
    setNames(afterEdit);
  };
  /** Resolves true when saved; false on problems, a refused or failed save (shown inline or toasted), or a save in flight. */
  const save = async (): Promise<boolean> => {
    if (!definition || !draft || savingRef.current || problems.count) return false;
    const { body } = compile(draft, otherNames);
    if (!body) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const outcome = await saveStateDefinition(definition.id, body);
      if (outcome.kind === 'saved') open(outcome.definition);
      else setNames((current) => afterSave(current, outcome, body.name));
      return outcome.kind === 'saved';
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  useEditorSaver(stateDefinitionEditorStore, { label: () => draft?.name || definition?.name || '', save });
  /** Copies the saved definition (not an unsaved draft) under a name the user picks. */
  const duplicate = async () => {
    if (!definition || !(await stateDefinitionEditorStore.confirmSwitch())) return;
    // A Save in that question may have changed the saved definition (or its name): copy what is stored now.
    const stored = stateDefinitionsStore.getSnapshot().find((item) => item.id === definition.id) ?? definition;
    const taken = definitions.map((item) => item.name);
    const asked = window.prompt('Name of the copy', uniqueName(`${stored.name}_copy`, taken));
    if (asked === null) return;
    const name = asked.trim();
    const problem = definitionNameProblem(name, taken);
    if (problem) {
      alerts.warning(problem);
      return;
    }
    const copy = await createStateDefinitionFrom(copyOf(stored, name));
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
    setNames(afterKeepName);
  };
  /** Back to the saved definition. A refused rename stays locked, but its banner and the name answers go. */
  const revert = () => {
    if (!definition) return;
    setDraft(toDraft(definition));
    setNames((current) => ({ locked: current.locked }));
  };
  const remove = async () => {
    if (!definition || !(await confirmDelete(`Delete state definition "${definition.name}"?`))) return;
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
    nameLocked: names.locked,
    nameTaken: names.taken,
    blocked: names.blocked,
    saving,
    change,
    save,
    duplicate,
    duplicateAs,
    keepName,
    revert,
    remove,
    back: () => closeEditor('stateDefinitions'),
  };
}
