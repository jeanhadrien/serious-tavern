import { useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { workflowSettingIssues, workflowSettings, type Workflow } from '@st/shared';
import { useWorkflowEditor } from './workflows/useWorkflowEditor.js';
import { WorkflowToolbar } from './workflows/WorkflowToolbar.js';
import { NodePalette } from './workflows/NodePalette.js';
import { WorkflowCanvas } from './workflows/WorkflowCanvas.js';
import { WorkflowConfigPanel } from './workflows/WorkflowConfigPanel.js';
import { WorkflowSettingsPanel } from './workflows/WorkflowSettingsPanel.js';
import { canvasToWorkflow } from './workflows/model.js';
import { toggleSettingsPanel } from './workflows/settingsDraft.js';
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
  const {
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
  } = useWorkflowEditor();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The draft's raw declarations (items that don't parse included); node panels hint the usable ones.
  const settings = workflow?.settings;
  const hinted = useMemo(() => workflowSettings({ settings }), [settings]);
  // A selected node's config wins over the settings panel.
  const settingsShown = settingsOpen && !canvas.current;
  const toggleSettings = () => {
    const next = toggleSettingsPanel(settingsShown);
    if (next.deselect) canvas.setSelected(undefined);
    setSettingsOpen(next.open);
  };
  return (
    <div className="workflow-layout">
      {workflow ? (
        <div className="editor">
          <WorkflowToolbar
            name={workflow.name}
            onNameChange={(name) => setWorkflow((prev) => prev && { ...prev, name })}
            settingsOpen={settingsShown}
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
                collections={collectionsList}
                stateDefinitions={stateDefinitionsList}
                settings={hinted}
                updateConfig={canvas.updateConfig}
                onDelete={canvas.deleteNode}
                onClose={() => canvas.setSelected(undefined)}
              />
            ) : (
              settingsOpen && (
                <WorkflowSettingsPanel
                  settings={settings}
                  // Raw items are kept as they are; saving refuses the ones that don't parse.
                  onChange={(next) =>
                    setWorkflow((prev) => prev && { ...prev, settings: next as Workflow['settings'] })
                  }
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
