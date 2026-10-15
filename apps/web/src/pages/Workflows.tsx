import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { workflowSettingIssues } from '@st/shared';
import { useWorkflowEditor } from './workflows/useWorkflowEditor.js';
import { WorkflowToolbar } from './workflows/WorkflowToolbar.js';
import { NodePalette } from './workflows/NodePalette.js';
import { WorkflowCanvas } from './workflows/WorkflowCanvas.js';
import { WorkflowConfigPanel } from './workflows/WorkflowConfigPanel.js';
import { WorkflowSettingsPanel } from './workflows/WorkflowSettingsPanel.js';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = workflow?.settings ?? [];
  // A selected node's config wins; closing it shows the settings again while they are open.
  const toggleSettings = () => {
    if (!settingsOpen) canvas.setSelected(undefined);
    setSettingsOpen(!settingsOpen || !!canvas.current);
  };
  return (
    <div className="workflow-layout">
      {workflow ? (
        <div className="editor">
          <WorkflowToolbar
            name={workflow.name}
            onNameChange={(name) => setWorkflow((prev) => prev && { ...prev, name })}
            settingsOpen={settingsOpen && !canvas.current}
            settingsIssues={workflowSettingIssues(settings).length}
            onToggleSettings={toggleSettings}
            onValidate={() => void validate()}
            onDuplicate={() => void duplicateWorkflow(canvasToWorkflow(workflow, canvas.nodes, canvas.edges))}
            onSave={() => void save()}
          />
          <div className="editor-body">
            <NodePalette types={types} onAdd={canvas.addAtCenter} />
            <WorkflowCanvas canvas={canvas} />
            {canvas.current ? (
              <WorkflowConfigPanel
                current={canvas.current}
                presets={presets}
                characters={characters}
                providersList={providersList}
                settings={settings}
                updateConfig={canvas.updateConfig}
                onDelete={canvas.deleteNode}
                onClose={() => canvas.setSelected(undefined)}
              />
            ) : (
              settingsOpen && (
                <WorkflowSettingsPanel
                  settings={settings}
                  onChange={(next) => setWorkflow((prev) => prev && { ...prev, settings: next })}
                  onClose={() => setSettingsOpen(false)}
                />
              )
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
