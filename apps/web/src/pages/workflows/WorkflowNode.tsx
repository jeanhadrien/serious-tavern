import { useEffect } from 'react';
import { Handle, Position, useConnection, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { canConnect, type PortDef } from '@st/shared/ports';
import type { CanvasNode } from './model.js';
import { portColors } from './port-colors.js';

export function WorkflowNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { descriptor } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, descriptor.inputs, descriptor.outputs, updateNodeInternals]);
  const connection = useConnection<CanvasNode>();
  const incompatible = (port: PortDef, type: 'source' | 'target') => {
    if (!connection.inProgress || !connection.fromHandle || connection.fromHandle.nodeId === id) return false;
    const start = connection.fromHandle;
    if (start.type === type) return true;
    const startPort = (
      start.type === 'source'
        ? connection.fromNode?.data.descriptor.outputs
        : connection.fromNode?.data.descriptor.inputs
    )?.find((item) => item.name === start.id);
    if (!startPort) return false;
    return !(type === 'target' ? canConnect(startPort, port) : canConnect(port, startPort)).ok;
  };
  const tooltip = (port: PortDef) =>
    `${port.label} (${port.dataType})${port.description ? ` — ${port.description}` : ''}`;
  return (
    <div className={`flow-node ${selected ? 'selected' : ''} ${data.unknown ? 'unknown-node' : ''}`}>
      <strong>{descriptor.label}</strong>
      <small>{descriptor.category}</small>
      {descriptor.inputs.map((port) => (
        <div className="port input-port" key={port.name} title={tooltip(port)}>
          <Handle
            type="target"
            id={port.name}
            position={Position.Left}
            className={incompatible(port, 'target') ? 'invalid-handle' : ''}
            style={{ top: '50%', background: incompatible(port, 'target') ? '#ef8186' : portColors[port.dataType] }}
          />
          {port.label}
          <span className="port-type">{port.dataType}</span>
        </div>
      ))}
      {descriptor.outputs.map((port) => (
        <div className="port output-port" key={port.name} title={tooltip(port)}>
          <span className="port-type">{port.dataType}</span>
          {port.label}
          <Handle
            type="source"
            id={port.name}
            position={Position.Right}
            className={incompatible(port, 'source') ? 'invalid-handle' : ''}
            style={{ top: '50%', background: incompatible(port, 'source') ? '#ef8186' : portColors[port.dataType] }}
          />
        </div>
      ))}
    </div>
  );
}
