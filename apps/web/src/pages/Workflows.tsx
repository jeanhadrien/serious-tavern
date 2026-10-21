import { useMemo, useState, type CSSProperties } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { workflowSettingIssues, workflowSettings, type Workflow } from '@st/shared';
import { useEscapeArea } from '../keyboard/escapeRegistry.js';
import { useShortcutArea } from '../keyboard/shortcutAreas.js';
import { useRunActivity } from '../stores/runActivity.js';
import { Splitter } from '../components/splitter/Splitter.js';
import { useStoredSize } from '../components/splitter/useStoredSize.js';
import { useWorkflowEditor } from './workflows/useWorkflowEditor.js';
import { WorkflowToolbar } from './workflows/WorkflowToolbar.js';
import { NodePalette } from './workflows/NodePalette.js';
import { WorkflowCanvas } from './workflows/WorkflowCanvas.js';
import { WorkflowConfigPanel } from './workflows/WorkflowConfigPanel.js';
import { WorkflowSettingsPanel } from './workflows/WorkflowSettingsPanel.js';
import { canvasToWorkflow } from './workflows/model.js';
import { toggleSettingsPanel } from './workflows/settingsDraft.js';
import { listedIssues } from './workflows/issueOverlay.js';
import { lastRunIO, lastRunIsStale } from './workflows/lastRunIO.js';
import { useLastRunLog } from './workflows/useLastRunLog.js';
import { duplicateWorkflow } from './workflows/workflowActions.js';
import './workflows/workflows.css';

// The node config panel and the settings panel share one slot and one remembered width; until the user sets it,
// each keeps its own default (300 and 340).
const PANEL_WIDTH = { min: 240, max: 720 };
const NO_RUN_STATUS = {};

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
    dirty,
    save,
    revert,
    validate,
    issues,
  } = useWorkflowEditor();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  // The draft's raw declarations (items that don't parse included); node panels hint the usable ones.
  const settings = workflow?.settings;
  const hinted = useMemo(() => workflowSettings({ settings }), [settings]);
  // A selected node's config wins over the settings panel.
  const settingsShown = settingsOpen && !canvas.current;
  const panelShown = canvas.current !== undefined || settingsOpen;
  const panelWidth = useStoredSize('workflow-panel', { ...PANEL_WIDTH, initial: canvas.current ? 300 : 340 });
  // The open chat's streaming run, when it is a run of this workflow (reply section only, and only in this tab).
  const activity = useRunActivity();
  const runStatus = workflow && activity.workflowId === workflow.id ? activity.nodes : NO_RUN_STATUS;
  // The node's inputs and output in the open chat's last run of this workflow (rebuilt from the log, so greyed when the
  // graph may have changed since).
  const lastLog = useLastRunLog(workflow?.id);
  const lastRun = useMemo(
    () =>
      lastLog && workflow && canvas.current
        ? {
            io: lastRunIO(lastLog, canvas.current.id, canvas.edges, canvas.nodes),
            stale: lastRunIsStale(lastLog, dirty, workflow.updatedAt),
            nameOf: (nodeId: string) => lastLog.nodes[nodeId]?.name,
          }
        : undefined,
    [lastLog, workflow, canvas.current, canvas.edges, canvas.nodes, dirty],
  );
  // The catalogs a node's one-line summary names records from (the panels get the same lists).
  const summaryContext = useMemo(
    () => ({
      presets,
      characters,
      providers: providersList,
      collections: collectionsList,
      stateDefinitions: stateDefinitionsList,
    }),
    [presets, characters, providersList, collectionsList, stateDefinitionsList],
  );
  const problems = useMemo(() => listedIssues(issues ?? []), [issues]);
  // Validate asks the engine at once: all clear is a toast, otherwise the list opens (or the settings panel, when
  // the problems are only the chat settings').
  const validateNow = async () => {
    const found = await validate();
    if (!found?.length) return;
    if (listedIssues(found).length) setIssuesOpen(true);
    else if (!settingsShown) toggleSettings();
  };
  const toggleSettings = () => {
    const next = toggleSettingsPanel(settingsShown);
    if (next.deselect) canvas.setSelected(undefined);
    setSettingsOpen(next.open);
  };
  // Escape first closes the selection and the node config or settings panel; the shell's default then closes the editor.
  useEscapeArea('editor:workflows', () => {
    if (canvas.current || canvas.hasSelection) canvas.deselect();
    else if (settingsOpen) setSettingsOpen(false);
    else return false;
    return true;
  });
  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z or +Y step through the canvas history; the copy and paste events copy and paste
  // nodes, and `/` opens the quick add (never inside a field).
  useShortcutArea('editor:workflows', {
    undo: canvas.undo,
    redo: canvas.redo,
    quickAdd: canvas.quickAdd,
    copy: canvas.copy,
    paste: canvas.paste,
  });
  return (
    <div className="workflow-layout">
      {workflow ? (
        <div className="editor">
          <WorkflowToolbar
            name={workflow.name}
            onNameChange={(name) => setWorkflow((prev) => prev && { ...prev, name })}
            dirty={dirty}
            settingsOpen={settingsShown}
            settingsIssues={workflowSettingIssues(settings).length}
            onToggleSettings={toggleSettings}
            issueCount={problems.length}
            issuesOpen={issuesOpen}
            onToggleIssues={() => setIssuesOpen((open) => !open)}
            onValidate={() => void validateNow()}
            onDuplicate={() =>
              void duplicateWorkflow(canvasToWorkflow(workflow, canvas.nodes, canvas.edges, canvas.notes))
            }
            onSave={() => void save()}
            onRevert={revert}
          />
          <div className="editor-body" style={{ '--config-panel-width': `${panelWidth.size}px` } as CSSProperties}>
            <NodePalette types={types} onAdd={canvas.addAtCenter} />
            <WorkflowCanvas
              canvas={canvas}
              issues={issues ?? []}
              issuesOpen={issuesOpen}
              onCloseIssues={() => setIssuesOpen(false)}
              runStatus={runStatus}
              summaryContext={summaryContext}
            />
            {panelShown && (
              <Splitter
                className="splitter-inline config-panel-splitter"
                label="Resize panel"
                value={panelWidth.size}
                min={PANEL_WIDTH.min}
                max={PANEL_WIDTH.max}
                direction={-1}
                onChange={panelWidth.setSize}
                onReset={panelWidth.reset}
              />
            )}
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
                lastRun={lastRun}
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
