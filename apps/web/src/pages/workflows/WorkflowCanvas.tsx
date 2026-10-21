import { useEffect, useRef } from 'react';
import { ReactFlow, Background, Controls, Panel, useNodesInitialized, useReactFlow } from '@xyflow/react';
import { Redo2, Trash2, Undo2 } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
import { checkConnection } from '../../connection.js';
import { useMediaQuery } from '../../useMediaQuery.js';
import { ConnectPicker } from './ConnectPicker.js';
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

export function WorkflowCanvas({ canvas }: { canvas: ReturnType<typeof useWorkflowCanvas> }) {
  const touch = useMediaQuery('(pointer: coarse)');
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
      <ReactFlow
        key={canvas.canvasVersion}
        nodes={canvas.nodes}
        edges={canvas.visibleEdges}
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
        <Background color="#414652" gap={20} />
        <Controls />
        <Panel position="top-right" className="canvas-actions">
          <IconButton icon={Undo2} label="Undo" disabled={!canvas.canUndo} onClick={() => canvas.undo()} />
          <IconButton icon={Redo2} label="Redo" disabled={!canvas.canRedo} onClick={() => canvas.redo()} />
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
      {canvas.picker && (
        <ConnectPicker picker={canvas.picker} onPick={canvas.pickCandidate} onClose={canvas.closePicker} />
      )}
    </div>
  );
}
