import { ReactFlow, Background, Controls } from '@xyflow/react';
import { checkConnection } from '../../connection.js';
import { WorkflowNode } from './WorkflowNode.js';
import type { useWorkflowCanvas } from './useWorkflowCanvas.js';

const nodeTypes = { workflow: WorkflowNode };

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
      <ReactFlow
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
        fitView
      >
        <Background color="#414652" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
