import { ReactFlowProvider } from '@xyflow/react';
import { useWorkflowEditor } from './workflows/useWorkflowEditor.js';
import { WorkflowToolbar } from './workflows/WorkflowToolbar.js';
import { NodePalette } from './workflows/NodePalette.js';
import { WorkflowCanvas } from './workflows/WorkflowCanvas.js';
import { WorkflowConfigPanel } from './workflows/WorkflowConfigPanel.js';
import { canvasToWorkflow } from './workflows/model.js';
import { duplicateWorkflow } from './workflows/workflowActions.js';
import './workflows/workflows.css';

export function Workflows() {
  return (
    <ReactFlowProvider>
      <WorkflowEditor />
    </ReactFlowProvider>
  );
}

function WorkflowEditor() {
  const { types, presets, characters, providersList, workflow, setWorkflow, canvas, save, validate } =
    useWorkflowEditor();
  return (
    <div className="workflow-layout">
      {workflow ? (
        <div className="editor">
          <WorkflowToolbar
            name={workflow.name}
            onNameChange={(name) => setWorkflow((prev) => prev && { ...prev, name })}
            onValidate={() => void validate()}
            onDuplicate={() => void duplicateWorkflow(canvasToWorkflow(workflow, canvas.nodes, canvas.edges))}
            onSave={() => void save()}
          />
          <div className="editor-body">
            <NodePalette types={types} onAdd={canvas.addAtCenter} />
            <WorkflowCanvas canvas={canvas} />
            {canvas.current && (
              <WorkflowConfigPanel
                current={canvas.current}
                presets={presets}
                characters={characters}
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
          <p>Choose a workflow in the list or create a new one.</p>
        </div>
      )}
    </div>
  );
}
