import { useEffect, useMemo, useState } from 'react';
import type { Edge } from '@xyflow/react';
import { workflowInvalidDetailsSchema, type Workflow, type NodeTypeDescriptor } from '@st/shared';
import { ApiError, workflowsApi, nodeTypesApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import {
  charactersStore,
  collectionsStore,
  presetsStore,
  providersStore,
  stateDefinitionsStore,
  useEditorCommands,
  useList,
  workflowEditorStore,
  workflowsStore,
} from '../../stores/index.js';
import { canvasToWorkflow, workflowToCanvas, type CanvasNode } from './model.js';
import { unsavableSettings, withDraftSettings } from './settingsDraft.js';
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
  const canvas = useWorkflowCanvas(types, presets, characters);

  useEffect(() => {
    void nodeTypesApi
      .list()
      .then(setTypes)
      .catch(() => {})
      .finally(() => setTypesReady(true));
  }, []);

  const load = (stored: Workflow) => {
    const next = withDraftSettings(stored);
    setWorkflow(next);
    canvas.load(next);
    const loaded = workflowToCanvas(next, types);
    setSaved(snapshot(next, loaded.nodes, loaded.edges));
  };
  const close = () => {
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

  const save = async (showToast = true): Promise<boolean> => {
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
      setSaved(snapshot({ ...workflow, updatedAt: updated.updatedAt }, canvas.nodes, canvas.edges));
      if (showToast) alerts.success('Workflow saved');
      await workflowsStore.refresh();
      return true;
    } catch {
      return false;
    }
  };
  const validate = async () => {
    if (!workflow) return;
    try {
      if (!(await save(false))) return;
      await workflowsApi.validate(workflow.id);
      canvas.setHighlightedEdge(undefined);
      alerts.success('Workflow is valid');
    } catch (error) {
      const invalid = error instanceof ApiError ? workflowInvalidDetailsSchema.safeParse(error.details) : undefined;
      if (invalid?.success) {
        const edgeId = invalid.data.issues.find((issue) => issue.edgeId)?.edgeId;
        canvas.setHighlightedEdge(edgeId);
      }
      /* API errors are toasted. */
    }
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
    save,
    validate,
  };
}
