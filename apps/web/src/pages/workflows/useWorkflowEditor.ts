import { useEffect, useMemo, useRef, useState } from 'react';
import type { Edge } from '@xyflow/react';
import type { Workflow, NodeTypeDescriptor } from '@st/shared';
import { workflowsApi, nodeTypesApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import {
  charactersStore,
  collectionsStore,
  presetsStore,
  providersStore,
  stateDefinitionsStore,
  useEditorCommands,
  useEditorSaver,
  useList,
  workflowEditorStore,
  workflowsStore,
} from '../../stores/index.js';
import { canvasToDraftBody, canvasToWorkflow, workflowToCanvas, type CanvasNode } from './model.js';
import { unsavableSettings, withDraftSettings } from './settingsDraft.js';
import { useDraftValidation } from './useDraftValidation.js';
import { useWorkflowCanvas } from './useWorkflowCanvas.js';

/** Serialization of a workflow as the canvas would save it; the dirty check compares these. */
const snapshot = (workflow: Workflow, nodes: CanvasNode[], edges: Edge[]) =>
  JSON.stringify(canvasToWorkflow(workflow, nodes, edges));

/**
 * The state of the workflow editor in M: the open workflow, its canvas and node types. Which workflow to open
 * comes from the list in L or from the layout URL (both through `workflowEditorStore`); the open workflow and
 * its dirty flag are published back to the store for the list, the header icon and the URL.
 */
export function useWorkflowEditor() {
  const presets = useList(presetsStore);
  const characters = useList(charactersStore);
  const [types, setTypes] = useState<NodeTypeDescriptor[]>([]);
  const [typesReady, setTypesReady] = useState(false);
  // The LLM node's provider dropdown; the store follows `providers.changed`.
  const providersList = useList(providersStore);
  // The Recall and Draw panels' collection pickers; the store follows `collections.changed`.
  const collectionsList = useList(collectionsStore);
  // The State Read and State Write pickers and the `{{state.*}}` hints; the store follows `stateDefinitions.changed`.
  const stateDefinitionsList = useList(stateDefinitionsStore);
  const [workflow, setWorkflow] = useState<Workflow>();
  const [saved, setSaved] = useState('');
  const canvas = useWorkflowCanvas(types, presets, characters, stateDefinitionsList);

  useEffect(() => {
    void nodeTypesApi
      .list()
      .then(setTypes)
      .catch(() => {})
      .finally(() => setTypesReady(true));
  }, []);

  // The workflow as last loaded or saved: what Revert goes back to.
  const stored = useRef<Workflow | undefined>(undefined);

  const load = (item: Workflow) => {
    stored.current = item;
    const next = withDraftSettings(item);
    setWorkflow(next);
    canvas.load(next);
    const loaded = workflowToCanvas(next, types);
    setSaved(snapshot(next, loaded.nodes, loaded.edges));
  };
  const close = () => {
    stored.current = undefined;
    setWorkflow(undefined);
    setSaved('');
    canvas.clear();
  };

  const dirty = useMemo(
    () => !!workflow && snapshot(workflow, canvas.nodes, canvas.edges) !== saved,
    [workflow, canvas.nodes, canvas.edges, saved],
  );
  const openId = workflow?.id;
  useEffect(() => workflowEditorStore.report(openId, dirty), [openId, dirty]);

  // The store's `focus` is an edge to highlight (validation links). Opening the workflow that is already
  // showing only moves the highlight, so unsaved canvas edits survive.
  useEditorCommands(
    workflowEditorStore,
    {
      open: (next, edgeId) => {
        if (workflow?.id !== next.id) load(next);
        if (edgeId) canvas.setHighlightedEdge(edgeId);
      },
      close: (id) => {
        if (workflow?.id === id) close();
      },
    },
    typesReady,
  );

  const save = async (): Promise<boolean> => {
    if (!workflow) return false;
    // The API would refuse it (400); say which declaration and leave the decision to the user.
    const blocked = unsavableSettings(workflow.settings);
    if (blocked) {
      alerts.error(`${blocked} Remove it under Chat settings, or fix the workflow file, to save.`, {
        title: 'Workflow not saved',
      });
      return false;
    }
    const current = canvasToWorkflow(workflow, canvas.nodes, canvas.edges);
    try {
      const updated = await workflowsApi.update(workflow.id, current);
      setWorkflow((prev) => (prev?.id === updated.id ? { ...prev, updatedAt: updated.updatedAt } : prev));
      stored.current = { ...current, updatedAt: updated.updatedAt };
      setSaved(snapshot({ ...workflow, updatedAt: updated.updatedAt }, canvas.nodes, canvas.edges));
      alerts.success('Workflow saved');
      await workflowsStore.refresh();
      return true;
    } catch {
      return false;
    }
  };
  /** Back to the saved workflow, through the same load that opening uses. */
  const revert = () => {
    if (stored.current) load(stored.current);
  };
  useEditorSaver(workflowEditorStore, { label: () => workflow?.name ?? '', save: () => save() });
  // The engine's verdict on the draft as it stands (nothing is saved), asked again shortly after each change.
  const draftBody = useMemo(
    () => workflow && canvasToDraftBody(workflow, canvas.nodes, canvas.edges),
    [workflow, canvas.nodes, canvas.edges],
  );
  const validation = useDraftValidation(workflow?.id, draftBody);
  const validate = async () => {
    const issues = await validation.validateNow();
    if (!issues) return;
    canvas.setHighlightedEdge(issues.find((issue) => issue.edgeId)?.edgeId);
    if (!issues.length) alerts.success('Workflow is valid');
    else
      alerts.warning(`${issues.length} problem(s) found`, {
        title: 'Workflow is invalid',
        details: issues.map((issue) => issue.message).join('\n'),
      });
  };
  return {
    types,
    presets,
    characters,
    providersList,
    collectionsList,
    stateDefinitionsList,
    workflow,
    setWorkflow,
    canvas,
    dirty,
    save,
    revert,
    validate,
    issues: validation.issues,
  };
}
