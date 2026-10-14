import { useEffect, useRef } from 'react';
import { ReactFlow, Background, Controls, Panel, useNodesInitialized, useReactFlow } from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
import { checkConnection } from '../../connection.js';
import { WorkflowNode } from './WorkflowNode.js';
import type { useWorkflowCanvas } from './useWorkflowCanvas.js';

const nodeTypes = { workflow: WorkflowNode };

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
  return (
    <div
      className="canvas"
      ref={canvas.canvasRef}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={canvas.onDrop}
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
        onNodeClick={(_, node) => canvas.setSelected(node.id)}
        onPaneClick={() => canvas.setSelected(undefined)}
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.2}
      >
        <FitWhenMeasured />
        <Background color="#414652" gap={20} />
        <Controls />
        {canvas.hasSelection && (
          <Panel position="top-right">
            <IconButton
              icon={Trash2}
              label="Delete selection"
              className="canvas-delete"
              onClick={canvas.deleteSelection}
            />
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
