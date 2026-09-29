import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position, useReactFlow,
  addEdge, applyNodeChanges, applyEdgeChanges,
  type Connection, type Edge as FlowEdge, type Node as FlowNode, type NodeProps, type OnNodesChange, type OnEdgesChange
} from '@xyflow/react';
import type { Workflow, NodeTypeDescriptor, NodeInstance } from '@st/shared';
import { NodeConfigPanel } from '@st/node-ui';
import { api, getNodeTypes, getWorkflows, json } from '../api.js';

type CanvasNode = FlowNode<{ descriptor: NodeTypeDescriptor; config: NodeInstance['config'] }>;
function WorkflowNode({ data, selected }: NodeProps<CanvasNode>) {
  const { descriptor } = data;
  return <div className={`flow-node ${selected ? 'selected' : ''}`}>
    <strong>{descriptor.label}</strong><small>{descriptor.category}</small>
    {descriptor.inputs.map(port => <div className="port input-port" key={port.name}>
      <Handle type="target" id={port.name} position={Position.Left} style={{ top: '50%' }} />{port.label}</div>)}
    {descriptor.outputs.map(port => <div className="port output-port" key={port.name}>
      {port.label}<Handle type="source" id={port.name} position={Position.Right} style={{ top: '50%' }} /></div>)}
  </div>;
}
const nodeTypes = { workflow: WorkflowNode };

export function Workflows() {
  return <ReactFlowProvider><WorkflowEditor /></ReactFlowProvider>;
}

function WorkflowEditor() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [types, setTypes] = useState<NodeTypeDescriptor[]>([]);
  const [workflow, setWorkflow] = useState<Workflow>();
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selected, setSelected] = useState<string>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const refresh = () => getWorkflows().then(setWorkflows);
  useEffect(() => { void refresh().catch(e => setError(String(e))); void getNodeTypes().then(setTypes).catch(e => setError(String(e))); }, []);
  const load = (next: Workflow) => {
    setWorkflow(next);
    setNodes(next.nodes.flatMap(n => {
      const descriptor = types.find(type => type.type === n.type);
      return descriptor ? [{ id: n.id, type: 'workflow', position: n.position,
        data: { descriptor, config: n.config } }] : [];
    }));
    setEdges(next.edges.map(e => ({ ...e })));
    setSelected(undefined);
    setMessage('');
    setError('');
  };
  const onNodesChange: OnNodesChange<CanvasNode> = useCallback(changes => {
    setNodes(prev => applyNodeChanges(changes, prev));
    const removed = changes.filter(change => change.type === 'remove').map(change => change.id);
    if (removed.length) {
      setEdges(prev => prev.filter(e => !removed.includes(e.source) && !removed.includes(e.target)));
      setSelected(prev => prev && removed.includes(prev) ? undefined : prev);
    }
  }, []);
  const onEdgesChange: OnEdgesChange = useCallback(changes => {
    setEdges(prev => applyEdgeChanges(changes, prev));
  }, []);
  const connect = useCallback((connection: Connection) => {
    if (!connection.sourceHandle || !connection.targetHandle) return;
    setEdges(prev => addEdge({ ...connection, id: crypto.randomUUID() },
      prev.filter(e => e.target !== connection.target || e.targetHandle !== connection.targetHandle)));
  }, []);
  const addNode = (descriptor: NodeTypeDescriptor, position: { x: number; y: number }) => {
    setNodes(prev => [...prev, { id: crypto.randomUUID(), type: 'workflow', position,
      data: { descriptor, config: { ...descriptor.defaultConfig } } }]);
  };
  const addAtCenter = (descriptor: NodeTypeDescriptor) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    addNode(descriptor, { x: position.x - 90, y: position.y - 40 });
  };
  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/st-node-type');
    const descriptor = types.find(item => item.type === type);
    if (descriptor) addNode(descriptor, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };
  const create = async () => {
    const name = window.prompt('Workflow name');
    if (!name?.trim()) return;
    try { const created = await api<Workflow>('/workflows', json('POST', { name })); await refresh(); load(created); }
    catch (e) { setError(String(e)); }
  };
  const save = async (): Promise<boolean> => {
    if (!workflow) return false;
    const current = { ...workflow,
      nodes: nodes.map(n => ({ id: n.id, type: n.data.descriptor.type, config: n.data.config, position: n.position })),
      edges: edges.map(e => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? '',
        target: e.target, targetHandle: e.targetHandle ?? '' })) };
    try { const updated = await api<Workflow>(`/workflows/${workflow.id}`, json('PUT', current));
      setWorkflow(prev => prev?.id === updated.id ? { ...prev, updatedAt: updated.updatedAt } : prev);
      await refresh(); setMessage('Saved'); setError(''); return true; }
    catch (e) { setError(String(e)); return false; }
  };
  const validate = async () => {
    if (!workflow) return;
    try {
      if (!await save()) return;
      const result = await api<{ valid: boolean; errors: string[] }>(`/workflows/${workflow.id}/validate`, json('POST'));
      setMessage(result.valid ? 'Workflow is valid ✓' : result.errors.join('\n')); setError('');
    } catch (e) { setError(String(e)); }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this workflow?')) return;
    try { await api(`/workflows/${id}`, json('DELETE'));
      if (workflow?.id === id) { setWorkflow(undefined); setNodes([]); setEdges([]); setSelected(undefined); }
      await refresh(); setError(''); }
    catch (e) { setError(String(e)); }
  };
  const current = nodes.find(n => n.id === selected);
  const currentDescriptor = current?.data.descriptor;
  const updateConfig = (config: NodeInstance['config']) => {
    setNodes(prev => prev.map(n => n.id === selected ? { ...n, data: { ...n.data, config } } : n));
  };
  return <div className="workflow-layout"><aside className="sidebar"><div className="toolbar"><h2>Workflows</h2>
    <button className="primary" onClick={() => void create()}>+ New</button></div>
    {workflows.map(w => <div key={w.id} className={`session-row ${workflow?.id === w.id ? 'selected' : ''}`}>
      <button className="session-link" disabled={!types.length} onClick={() => load(structuredClone(w))}>{w.name}</button>
      <button title="Delete workflow" onClick={() => void remove(w.id)}>×</button></div>)}</aside>
    {workflow ? <div className="editor"><div className="editor-toolbar">
      <input aria-label="Workflow name" value={workflow.name} onChange={e => setWorkflow(prev => prev && ({ ...prev, name: e.target.value }))} />
      <button onClick={() => void validate()}>Validate</button><button className="primary" onClick={() => void save()}>Save</button>
      {message && <span className="hint" style={{ whiteSpace: 'pre-wrap' }}>{message}</span>}{error && <span className="error">{error}</span>}</div>
      <div className="editor-body"><aside className="palette"><h3>Nodes</h3>{types.map(t =>
        <button title={t.description} key={t.type} draggable onDragStart={event => {
          event.dataTransfer.setData('application/st-node-type', t.type);
          event.dataTransfer.effectAllowed = 'copy';
        }} onClick={() => addAtCenter(t)}><small>{t.category}</small>{t.label} +</button>)}
        <p className="hint">Click to add at center or drag onto the canvas. Drag nodes to move; connect handles; press Delete to remove.</p></aside>
        <div className="canvas" ref={canvasRef} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
          onDrop={onDrop}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect}
          onNodeClick={(_, node) => setSelected(node.id)} onPaneClick={() => setSelected(undefined)}
          deleteKeyCode={['Backspace', 'Delete']}
          fitView><Background color="#414652" gap={20} /><Controls /></ReactFlow></div>
        {current && currentDescriptor && <aside className="config-panel"><div className="toolbar"><h3>{currentDescriptor.label}</h3>
          <button onClick={() => setSelected(undefined)}>×</button></div><p className="hint">{currentDescriptor.description}</p>
          <NodeConfigPanel descriptor={currentDescriptor} config={current.data.config} onChange={updateConfig} /></aside>}</div></div> :
      <div className="empty-state"><h1>Build a workflow</h1><p>Choose a workflow or create a new one.</p>{error && <p className="error">{error}</p>}</div>}</div>;
}
