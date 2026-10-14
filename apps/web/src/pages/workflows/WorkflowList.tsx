import { Copy, Plus, Trash2 } from 'lucide-react';
import type { Workflow } from '@st/shared';
import { workflowsApi } from '../../api.js';
import { IconButton } from '../../components/IconButton.js';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { useEditorState, useList, workflowEditorStore, workflowsStore } from '../../stores/index.js';
import { duplicateWorkflow } from './workflowActions.js';

/** The workflow list shown in L: picking a workflow opens it in the editor in M. */
export function WorkflowList() {
  const workflows = useList(workflowsStore);
  const { currentId, dirty } = useEditorState(workflowEditorStore);
  const { openEditor } = useLayoutActions();

  const open = (workflow: Workflow) => {
    workflowEditorStore.open(structuredClone(workflow));
    openEditor('workflows');
  };
  const create = async () => {
    const name = window.prompt('Workflow name');
    if (!name?.trim()) return;
    try {
      const created = await workflowsApi.create({ name });
      await workflowsStore.refresh();
      open(created);
    } catch {
      /* API errors are toasted. */
    }
  };
  const remove = async (workflow: Workflow) => {
    if (!window.confirm(`Delete ${workflow.name}?`)) return;
    try {
      await workflowsApi.delete(workflow.id);
      workflowEditorStore.discard(workflow.id);
      await workflowsStore.refresh();
    } catch {
      /* API errors are toasted. */
    }
  };

  return (
    <aside className="sidebar resource-list" aria-label="Workflows">
      <div className="toolbar">
        <h2>Workflows</h2>
        <button type="button" className="primary" onClick={() => void create()}>
          <Plus size={18} aria-hidden="true" /> New
        </button>
      </div>
      {workflows.map((workflow) => (
        <div className={`session-row ${currentId === workflow.id ? 'selected' : ''}`} key={workflow.id}>
          <button
            type="button"
            className="session-link"
            aria-current={currentId === workflow.id ? 'true' : undefined}
            onClick={() => open(workflow)}
          >
            {workflow.name}
            {dirty && currentId === workflow.id && (
              <span className="dirty-dot" title="Unsaved changes">
                {' '}
                •
              </span>
            )}
          </button>
          <IconButton
            icon={Copy}
            label={`Duplicate ${workflow.name}`}
            onClick={() => void duplicateWorkflow(workflow).then((ok) => ok && openEditor('workflows'))}
          />
          <IconButton icon={Trash2} label={`Delete ${workflow.name}`} onClick={() => void remove(workflow)} />
        </div>
      ))}
    </aside>
  );
}
