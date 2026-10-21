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
    `${port.label} (${port.dataType}${port.required ? ', required' : ''})${port.description ? ` — ${port.description}` : ''}`;
  return (
    <div className={`flow-node ${selected ? 'selected' : ''} ${data.unknown ? 'unknown-node' : ''}`}>
      <div className="flow-header">
        <strong>{data.name}</strong>
        <small>{descriptor.category}</small>
      </div>
      {descriptor.inputs.map((port) => {
        const invalid = incompatible(port, 'target');
        return (
          <div className={`port input-port${invalid ? ' invalid-port' : ''}`} key={port.name} title={tooltip(port)}>
            <Handle
              type="target"
              id={port.name}
              position={Position.Left}
              className={invalid ? 'invalid-handle' : ''}
              style={{ top: '50%', background: invalid ? '#ef8186' : portColors[port.dataType] }}
            />
            {port.label}
            {/* A plain marker: whether the input is connected is the validation's business, not the dot's. */}
            {port.required && <i className="required-dot" aria-hidden="true" />}
            <span className="port-type">{port.dataType}</span>
          </div>
        );
      })}
      {descriptor.outputs.map((port) => {
        const invalid = incompatible(port, 'source');
        return (
          <div className={`port output-port${invalid ? ' invalid-port' : ''}`} key={port.name} title={tooltip(port)}>
            <span className="port-type">{port.dataType}</span>
            {port.label}
            <Handle
              type="source"
              id={port.name}
              position={Position.Right}
              className={invalid ? 'invalid-handle' : ''}
              style={{ top: '50%', background: invalid ? '#ef8186' : portColors[port.dataType] }}
            />
          </div>
        );
      })}
    </div>
  );
}
