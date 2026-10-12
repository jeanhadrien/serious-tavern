import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  workflowInvalidDetailsSchema,
  type Character,
  type Workflow,
  type NodeTypeDescriptor,
  type Preset,
  type ApiResponse,
} from '@st/shared';
import { subscribeToChanges } from '../../api/events.js';
import { ApiError, charactersApi, workflowsApi, nodeTypesApi, presetsApi, providersApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import { compareRecent } from '../recentOrder.js';
import { canvasToWorkflow } from './model.js';
import { useWorkflowCanvas } from './useWorkflowCanvas.js';

export function useWorkflowEditor() {
  const [searchParams] = useSearchParams();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [types, setTypes] = useState<NodeTypeDescriptor[]>([]);
  const [typesReady, setTypesReady] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [providersList, setProvidersList] = useState<ApiResponse<'listProviders'>>([]);
  const [workflow, setWorkflow] = useState<Workflow>();
  const canvas = useWorkflowCanvas(types, presets, characters);
  const refresh = () =>
    workflowsApi.list().then((list) => setWorkflows(list.sort((a, b) => compareRecent(a, b, (item) => item.name))));
  const refreshResources = () => {
    void charactersApi
      .list()
      .then(setCharacters)
      .catch(() => {});
    void presetsApi
      .list()
      .then(setPresets)
      .catch(() => {});
  };
  useEffect(() => {
    void refresh().catch(() => {});
    void charactersApi
      .list()
      .then(setCharacters)
      .catch(() => {});
    void nodeTypesApi
      .list()
      .then(setTypes)
      .catch(() => {})
      .finally(() => setTypesReady(true));
    void presetsApi
      .list()
      .then(setPresets)
      .catch(() => {});
    void providersApi
      .list()
      .then(setProvidersList)
      .catch(() => {});
  }, []);
  useEffect(() => {
    window.addEventListener('focus', refreshResources);
    return () => window.removeEventListener('focus', refreshResources);
  }, []);
  useEffect(
    // Preset files edited on disk: refetch so LLM nodes re-resolve their ports. An unchanged catalog keeps
    // its identity, so our own saves do not trigger port resolution.
    () =>
      subscribeToChanges((event) => {
        if (event.type !== 'presets.changed') return;
        void presetsApi
          .list({ silent: true })
          .then((next) => setPresets((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next)))
          .catch(() => {});
      }),
    [],
  );
  const load = (next: Workflow) => {
    setWorkflow(next);
    canvas.load(next);
  };
  const loadRef = useRef(load);
  loadRef.current = load;
  const workflowRef = useRef(workflow);
  workflowRef.current = workflow;
  const requestedWorkflowId = searchParams.get('workflow');
  const requestedEdgeId = searchParams.get('edge');
  const deepLinkRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Tabs stay mounted, so a validation link must also work when the editor
    // already has a workflow open. The guard resets once the link target is left.
    if (!requestedWorkflowId) {
      deepLinkRef.current = undefined;
      return;
    }
    const linkKey = `${requestedWorkflowId}|${requestedEdgeId ?? ''}`;
    if (deepLinkRef.current === linkKey) return;
    deepLinkRef.current = linkKey;
    if (workflowRef.current?.id === requestedWorkflowId) {
      // Already open: only move the highlight and keep unsaved canvas edits.
      canvas.setHighlightedEdge(requestedEdgeId ?? undefined);
      return;
    }
    let active = true;
    void workflowsApi
      .get(requestedWorkflowId)
      .then((loaded) => {
        if (!active) return;
        loadRef.current(loaded);
        canvas.setHighlightedEdge(requestedEdgeId ?? undefined);
      })
      .catch(() => {
        deepLinkRef.current = undefined;
      });
    return () => {
      active = false;
      if (deepLinkRef.current === linkKey) deepLinkRef.current = undefined;
    };
  }, [requestedWorkflowId, requestedEdgeId, canvas.setHighlightedEdge]);
  const create = async () => {
    if (!typesReady) return;
    const name = window.prompt('Workflow name');
    if (!name?.trim()) return;
    try {
      const created = await workflowsApi.create({ name });
      await refresh();
      load(created);
    } catch {
      /* API errors are toasted. */
    }
  };
  const save = async (showToast = true): Promise<boolean> => {
    if (!workflow) return false;
    const current = canvasToWorkflow(workflow, canvas.nodes, canvas.edges);
    try {
      const updated = await workflowsApi.update(workflow.id, current);
      setWorkflow((prev) => (prev?.id === updated.id ? { ...prev, updatedAt: updated.updatedAt } : prev));
      if (showToast) alerts.success('Workflow saved');
      await refresh();
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
  const remove = async (id: string) => {
    if (!window.confirm('Delete this workflow?')) return;
    try {
      await workflowsApi.delete(id);
      if (workflow?.id === id) {
        setWorkflow(undefined);
        canvas.clear();
      }
      await refresh();
    } catch {
      /* API errors are toasted. */
    }
  };
  return {
    workflows,
    types,
    typesReady,
    presets,
    characters,
    providersList,
    workflow,
    setWorkflow,
    canvas,
    load,
    create,
    save,
    validate,
    remove,
    refreshResources,
  };
}
