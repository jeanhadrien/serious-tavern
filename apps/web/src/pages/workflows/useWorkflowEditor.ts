import { useEffect, useMemo, useRef, useState } from 'react';
import type { Edge } from '@xyflow/react';
import { useLocation } from 'react-router-dom';
import { workflowInvalidDetailsSchema, type Workflow, type NodeTypeDescriptor, type ApiResponse } from '@st/shared';
import { ApiError, workflowsApi, nodeTypesApi, providersApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import {
  charactersStore,
  presetsStore,
  useEditorCommands,
  useList,
  workflowEditorStore,
  workflowsStore,
} from '../../stores/index.js';
import { canvasToWorkflow, workflowToCanvas, type CanvasNode } from './model.js';
import { useWorkflowCanvas } from './useWorkflowCanvas.js';

/** Serialization of a workflow as the canvas would save it; the dirty check compares these. */
const snapshot = (workflow: Workflow, nodes: CanvasNode[], edges: Edge[]) =>
  JSON.stringify(canvasToWorkflow(workflow, nodes, edges));

/**
 * The state of the workflow editor in M: the open workflow, its canvas and node types. Which workflow to open
 * comes from the list in L (through `workflowEditorStore`) or from a `?workflow=&edge=` link; the open workflow and
 * its dirty flag are published back to the store for the list and the header icon.
 */
export function useWorkflowEditor() {
  const { key: locationKey, search } = useLocation();
  const presets = useList(presetsStore);
  const characters = useList(charactersStore);
  const [types, setTypes] = useState<NodeTypeDescriptor[]>([]);
  const [typesReady, setTypesReady] = useState(false);
  const [providersList, setProvidersList] = useState<ApiResponse<'listProviders'>>([]);
  const [workflow, setWorkflow] = useState<Workflow>();
  const [saved, setSaved] = useState('');
  const canvas = useWorkflowCanvas(types, presets, characters);

  useEffect(() => {
    void nodeTypesApi
      .list()
      .then(setTypes)
      .catch(() => {})
      .finally(() => setTypesReady(true));
    void providersApi
      .list()
      .then(setProvidersList)
      .catch(() => {});
  }, []);

  const load = (next: Workflow) => {
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

  useEditorCommands(
    workflowEditorStore,
    {
      open: load,
      close: (id) => {
        if (workflow?.id === id) close();
      },
    },
    typesReady,
  );

  // A validation link (`?workflow=…&edge=…`) opens that workflow and highlights the edge. It is handled once per
  // navigation, so it also works when the editor already shows another workflow.
  const linkHandled = useRef<string | undefined>(undefined);
  useEffect(() => {
    const params = new URLSearchParams(search);
    const requestedWorkflowId = params.get('workflow');
    const requestedEdgeId = params.get('edge') ?? undefined;
    if (!requestedWorkflowId || !typesReady || linkHandled.current === locationKey) return;
    linkHandled.current = locationKey;
    if (workflow?.id === requestedWorkflowId) {
      // Already open: only move the highlight and keep unsaved canvas edits.
      canvas.setHighlightedEdge(requestedEdgeId);
      return;
    }
    void workflowsApi
      .get(requestedWorkflowId)
      .then((loaded) => {
        load(loaded);
        canvas.setHighlightedEdge(requestedEdgeId);
      })
      .catch(() => {
        linkHandled.current = undefined;
      });
  }, [locationKey, search, typesReady]);

  const save = async (showToast = true): Promise<boolean> => {
    if (!workflow) return false;
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
  return { types, presets, characters, providersList, workflow, setWorkflow, canvas, save, validate };
}
