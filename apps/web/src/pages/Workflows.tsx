import { ReactFlowProvider } from '@xyflow/react';
import { useWorkflowEditor } from './workflows/useWorkflowEditor.js';
import { WorkflowToolbar } from './workflows/WorkflowToolbar.js';
import { NodePalette } from './workflows/NodePalette.js';
import { WorkflowCanvas } from './workflows/WorkflowCanvas.js';
import { WorkflowConfigPanel } from './workflows/WorkflowConfigPanel.js';

export function Workflows() {
  return (
    <ReactFlowProvider>
      <WorkflowEditor />
    </ReactFlowProvider>
  );
}

function WorkflowEditor() {
  const {
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
  } = useWorkflowEditor();
  return (
    <div className="workflow-layout">
      <aside className="sidebar">
        <div className="toolbar">
          <h2>Workflows</h2>
          <button className="primary" disabled={!typesReady} onClick={() => void create()}>
            + New
          </button>
        </div>
        {workflows.map((w) => (
          <div key={w.id} className={`session-row ${workflow?.id === w.id ? 'selected' : ''}`}>
            <button className="session-link" disabled={!typesReady} onClick={() => load(structuredClone(w))}>
              {w.name}
            </button>
            <button title="Delete workflow" onClick={() => void remove(w.id)}>
              ×
            </button>
          </div>
        ))}
      </aside>
      {workflow ? (
        <div className="editor">
          <WorkflowToolbar
            name={workflow.name}
            onNameChange={(name) => setWorkflow((prev) => prev && { ...prev, name })}
            onValidate={() => void validate()}
            onSave={() => void save()}
          />
          <div className="editor-body">
            <NodePalette types={types} onAdd={canvas.addAtCenter} />
            <WorkflowCanvas canvas={canvas} />
            {canvas.current && (
              <WorkflowConfigPanel
                current={canvas.current}
                presets={presets}
                providersList={providersList}
                updateConfig={canvas.updateConfig}
                onClose={() => canvas.setSelected(undefined)}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <h1>Build a workflow</h1>
          <p>Choose a workflow or create a new one.</p>
        </div>
      )}
    </div>
  );
}
