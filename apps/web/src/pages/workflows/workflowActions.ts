import type { Workflow } from '@st/shared';
import { workflowsApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import { workflowEditorStore, workflowsStore } from '../../stores/index.js';

/**
 * Creates "<name> copy" from a workflow's graph and chat settings and opens it in the editor. Shared by the list (saved version)
 * and the editor toolbar (current canvas). Resolves with whether it succeeded; API errors are toasted.
 */
export async function duplicateWorkflow(
  source: Pick<Workflow, 'name' | 'nodes' | 'edges' | 'settings'>,
): Promise<boolean> {
  try {
    const copy = await workflowsApi.create({
      name: `${source.name} copy`,
      nodes: structuredClone(source.nodes),
      edges: structuredClone(source.edges),
      settings: structuredClone(source.settings ?? []),
    });
    await workflowsStore.refresh();
    workflowEditorStore.open(copy);
    alerts.success('Workflow duplicated');
    return true;
  } catch {
    return false;
  }
}
