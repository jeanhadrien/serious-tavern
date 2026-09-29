import { useEffect, useState } from 'react';
import type { Workflow, NodeTypeDescriptor, Preset, ApiResponse } from '@st/shared';
import { workflowsApi, nodeTypesApi, presetsApi, providersApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import { canvasToWorkflow } from './model.js';
import { useWorkflowCanvas } from './useWorkflowCanvas.js';

export function useWorkflowEditor() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [types, setTypes] = useState<NodeTypeDescriptor[]>([]);
  const [typesReady, setTypesReady] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [providersList, setProvidersList] = useState<ApiResponse<'listProviders'>>([]);
  const [workflow, setWorkflow] = useState<Workflow>();
  const canvas = useWorkflowCanvas(types, presets);
  const refresh = () => workflowsApi.list().then(setWorkflows);
  useEffect(() => {
    void refresh().catch(() => {});
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
    const update = () => {
      void presetsApi
        .list()
        .then(setPresets)
        .catch(() => {});
    };
    window.addEventListener('focus', update);
    return () => window.removeEventListener('focus', update);
  }, []);
  const load = (next: Workflow) => {
    setWorkflow(next);
    canvas.load(next);
  };
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
      alerts.success('Workflow is valid');
    } catch {
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
    providersList,
    workflow,
    setWorkflow,
    canvas,
    load,
    create,
    save,
    validate,
    remove,
  };
}
