import { useEffect, useMemo, useRef } from 'react';
import { ReactFlow, Background, Controls, Panel, useNodesInitialized, useReactFlow } from '@xyflow/react';
import { Network, Redo2, Trash2, Undo2 } from 'lucide-react';
import type { ValidationIssue } from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { checkConnection } from '../../connection.js';
import { useMediaQuery } from '../../useMediaQuery.js';
import { CanvasOverlayContext, type CanvasOverlay } from './CanvasOverlayContext.js';
import { ConnectPicker } from './ConnectPicker.js';
import { styleEdges } from './edgeStyle.js';
import { IssueList } from './IssueList.js';
import { issueEdgeIds, issuesByNode, issueTargets, listedIssues } from './issueOverlay.js';
import { WorkflowNode } from './WorkflowNode.js';
import type { useWorkflowCanvas } from './useWorkflowCanvas.js';

const nodeTypes = { workflow: WorkflowNode };

// How near a handle a dropped connection still snaps to it: a finger is less exact than a mouse (React Flow's own is 20).
const TOUCH_CONNECTION_RADIUS = 40;

// React Flow's `fitView` prop can run before the nodes are measured and then zooms right in on nothing.
// This fits once they are, once per mounted canvas (it remounts for each loaded workflow): nodes added later
// briefly read as unmeasured again and must not move the view.
function FitWhenMeasured() {
  const measured = useNodesInitialized();
  const { fitView } = useReactFlow();
  const fitted = useRef(false);
  useEffect(() => {
    if (!measured || fitted.current) return;
    fitted.current = true;
    void fitView();
  }, [measured, fitView]);
  return null;
}

// Selects and fits the node a link asked to show, once the canvas has measured its nodes.
function ShowNode({ id, onShown, show }: { id?: string; onShown: () => void; show: (ids: string[]) => void }) {
  const measured = useNodesInitialized();
  useEffect(() => {
    if (!id || !measured) return;
    show([id]);
    onShown();
  }, [id, measured, show, onShown]);
  return null;
}

export function WorkflowCanvas({
  canvas,
  issues,
  issuesOpen,
  onCloseIssues,
  runStatus,
  summaryContext,
}: {
  canvas: ReturnType<typeof useWorkflowCanvas>;
  /** The engine's problems with the draft; the canvas marks the nodes and connections they name. */
  issues: readonly ValidationIssue[];
  issuesOpen: boolean;
  onCloseIssues: () => void;
  /** Where the nodes of the run streaming now stand, when it is a run of this workflow. */
  runStatus: CanvasOverlay['runStatus'];
  /** The catalogs the nodes' summaries name records from. */
  summaryContext: CanvasOverlay['summaryContext'];
}) {
  const touch = useMediaQuery('(pointer: coarse)');
  const { nodes, edges, highlightedEdge } = canvas;
  const overlay = useMemo(
    () => ({ issuesByNode: issuesByNode(issues), runStatus, summaryContext }),
    [issues, runStatus, summaryContext],
  );
  const drawnEdges = useMemo(
    () => styleEdges(edges, nodes, { focused: highlightedEdge, issues: issueEdgeIds(issues) }),
    [edges, nodes, highlightedEdge, issues],
  );
  const entries = useMemo(
    () => listedIssues(issues).map((issue) => ({ issue, targets: issueTargets(issue, edges) })),
    [issues, edges],
  );
  return (
    <div
      className="canvas"
      ref={canvas.canvasRef}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={canvas.onDrop}
      onDoubleClick={canvas.onDoubleClick}
      onPointerMove={canvas.trackPointer}
      onPointerLeave={canvas.forgetPointer}
    >
      {/* Remounted for each loaded workflow, so `fitView` fits it into this (possibly narrow) column. */}
      <CanvasOverlayContext value={overlay}>
        <ReactFlow
          key={canvas.canvasVersion}
          nodes={canvas.nodes}
          edges={drawnEdges}
          nodeTypes={nodeTypes}
          onNodesChange={canvas.onNodesChange}
          onEdgesChange={canvas.onEdgesChange}
          onConnect={canvas.connect}
          onConnectEnd={canvas.onConnectEnd}
          isValidConnection={(connection) => checkConnection(connection, canvas.nodes).ok}
          onNodeDragStart={canvas.onDragStart}
          onNodeDragStop={(_event, _node, dragged) => canvas.onDragStop(dragged)}
          onSelectionDragStart={canvas.onDragStart}
          onSelectionDragStop={(_event, dragged) => canvas.onDragStop(dragged)}
          onNodeClick={(_, node) => canvas.setSelected(node.id)}
          onPaneClick={() => canvas.setSelected(undefined)}
          deleteKeyCode={['Backspace', 'Delete']}
          minZoom={0.2}
          zoomOnDoubleClick={false}
          connectionRadius={touch ? TOUCH_CONNECTION_RADIUS : undefined}
        >
          <FitWhenMeasured />
          <ShowNode
            id={canvas.nodeToShow}
            show={(ids) => canvas.focusIssue(ids)}
            onShown={() => canvas.showNode(undefined)}
          />
          <Background color="#414652" gap={20} />
          <Controls />
          <Panel position="top-right" className="canvas-actions">
            <IconButton icon={Undo2} label="Undo" disabled={!canvas.canUndo} onClick={() => canvas.undo()} />
            <IconButton icon={Redo2} label="Redo" disabled={!canvas.canRedo} onClick={() => canvas.redo()} />
            <IconButton icon={Network} label="Tidy" disabled={!canvas.nodes.length} onClick={canvas.tidy} />
            {canvas.hasSelection && (
              <IconButton
                icon={Trash2}
                label="Delete selection"
                className="delete-button"
                onClick={canvas.deleteSelection}
              />
            )}
          </Panel>
        </ReactFlow>
      </CanvasOverlayContext>
      {issuesOpen && (
        <IssueList
          entries={entries}
          onPick={(targets) => canvas.focusIssue(targets.nodeIds, targets.edgeId)}
          onClose={onCloseIssues}
        />
      )}
      {canvas.picker && (
        <ConnectPicker picker={canvas.picker} onPick={canvas.pickCandidate} onClose={canvas.closePicker} />
      )}
    </div>
  );
}
