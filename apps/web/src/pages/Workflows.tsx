import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, Background, Controls, Handle, Position, addEdge, applyNodeChanges, applyEdgeChanges,
  type Connection, type Edge as FlowEdge, type Node as FlowNode, type NodeProps, type OnNodesChange, type OnEdgesChange
} from '@xyflow/react';
import type { Workflow, NodeTypeDescriptor, NodeInstance } from '@st/shared';
import { NodeConfigPanel } from '@st/node-ui';
import { api, getNodeTypes, getWorkflows, json } from '../api.js';

type CanvasNode = FlowNode<{ descriptor: NodeTypeDescriptor }>;
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
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [types, setTypes] = useState<NodeTypeDescriptor[]>([]);
  const [workflow, setWorkflow] = useState<Workflow>();
  const [selected, setSelected] = useState<string>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = () => getWorkflows().then(setWorkflows);
  useEffect(() => { void refresh().catch(e => setError(String(e))); void getNodeTypes().then(setTypes).catch(e => setError(String(e))); }, []);
  const descriptors = useMemo(() => new Map(types.map(t => [t.type, t])), [types]);
  const canvasNodes: CanvasNode[] = useMemo(() => (workflow?.nodes ?? []).flatMap(n => {
    const descriptor = descriptors.get(n.type);
    return descriptor ? [{ id: n.id, type: 'workflow', position: n.position, data: { descriptor } }] : [];
  }), [workflow?.nodes, descriptors]);
  const canvasEdges: FlowEdge[] = useMemo(() => (workflow?.edges ?? []).map(e => ({
    id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle
  })), [workflow?.edges]);
  const onNodesChange: OnNodesChange<CanvasNode> = useCallback(changes => {
    setWorkflow(prev => prev && ({
      ...prev, nodes: applyNodeChanges(changes, prev.nodes.map(n => ({
        id: n.id, type: 'workflow', position: n.position, data: { descriptor: descriptors.get(n.type)! }
      }))).map(n => ({ ...prev.nodes.find(old => old.id === n.id)!, position: n.position })),
      edges: prev.edges.filter(e => !changes.some(c => c.type === 'remove' && (c.id === e.source || c.id === e.target)))
    }));
  }, [descriptors]);
  const onEdgesChange: OnEdgesChange = useCallback(changes => {
    setWorkflow(prev => prev && ({ ...prev, edges: applyEdgeChanges(changes, prev.edges.map(e => ({
      id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle
    }))).map(e => ({ id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle ?? '', targetHandle: e.targetHandle ?? '' })) }));
  }, []);
  const connect = useCallback((connection: Connection) => {
    if (!connection.sourceHandle || !connection.targetHandle) return;
    setWorkflow(prev => prev && ({ ...prev, edges: addEdge(connection, prev.edges.map(e => ({
      ...e
    }))).map(e => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? '',
      target: e.target, targetHandle: e.targetHandle ?? '' })) }));
  }, []);
  const addNode = (descriptor: NodeTypeDescriptor) => {
    setWorkflow(prev => prev && ({ ...prev, nodes: [...prev.nodes, { id: crypto.randomUUID(), type: descriptor.type,
      config: { ...descriptor.defaultConfig }, position: { x: 150 + Math.random() * 250, y: 100 + Math.random() * 250 } }] }));
  };
  const create = async () => {
    const name = window.prompt('Workflow name');
    if (!name?.trim()) return;
    try { const created = await api<Workflow>('/workflows', json('POST', { name })); await refresh(); setWorkflow(created); setSelected(undefined); setMessage(''); setError(''); }
    catch (e) { setError(String(e)); }
  };
  const save = async (): Promise<boolean> => {
    if (!workflow) return false;
    try { const updated = await api<Workflow>(`/workflows/${workflow.id}`, json('PUT', workflow));
      setWorkflow(updated); await refresh(); setMessage('Saved'); setError(''); return true; }
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
    try { await api(`/workflows/${id}`, json('DELETE')); if (workflow?.id === id) setWorkflow(undefined); await refresh(); setError(''); }
    catch (e) { setError(String(e)); }
  };
  const current = workflow?.nodes.find(n => n.id === selected);
  const currentDescriptor = current && descriptors.get(current.type);
  const updateConfig = (config: NodeInstance['config']) => {
    setWorkflow(prev => prev && ({ ...prev, nodes: prev.nodes.map(n => n.id === selected ? { ...n, config } : n) }));
  };
  return <div className="workflow-layout"><aside className="sidebar"><div className="toolbar"><h2>Workflows</h2>
    <button className="primary" onClick={() => void create()}>+ New</button></div>
    {workflows.map(w => <div key={w.id} className={`session-row ${workflow?.id === w.id ? 'selected' : ''}`}>
      <button className="session-link" onClick={() => { setWorkflow(structuredClone(w)); setSelected(undefined); setMessage(''); }}>{w.name}</button>
      <button title="Delete workflow" onClick={() => void remove(w.id)}>×</button></div>)}</aside>
    {workflow ? <div className="editor"><div className="editor-toolbar">
      <input aria-label="Workflow name" value={workflow.name} onChange={e => setWorkflow({ ...workflow, name: e.target.value })} />
      <button onClick={() => void validate()}>Validate</button><button className="primary" onClick={() => void save()}>Save</button>
      {message && <span className="hint" style={{ whiteSpace: 'pre-wrap' }}>{message}</span>}{error && <span className="error">{error}</span>}</div>
      <div className="editor-body"><aside className="palette"><h3>Nodes</h3>{types.map(t =>
        <button title={t.description} key={t.type} onClick={() => addNode(t)}><small>{t.category}</small>{t.label} +</button>)}
        <p className="hint">Click to add. Drag to connect handles. Select and press Delete to remove.</p></aside>
        <div className="canvas"><ReactFlow nodes={canvasNodes} edges={canvasEdges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect}
          onNodeClick={(_, node) => setSelected(node.id)} onPaneClick={() => setSelected(undefined)}
          onNodesDelete={nodes => { if (nodes.some(n => n.id === selected)) setSelected(undefined); }}
          fitView><Background color="#414652" gap={20} /><Controls /></ReactFlow></div>
        {current && currentDescriptor && <aside className="config-panel"><div className="toolbar"><h3>{currentDescriptor.label}</h3>
          <button onClick={() => setSelected(undefined)}>×</button></div><p className="hint">{currentDescriptor.description}</p>
          <NodeConfigPanel descriptor={currentDescriptor} config={current.config} onChange={updateConfig} /></aside>}</div></div> :
      <div className="empty-state"><h1>Build a workflow</h1><p>Choose a workflow or create a new one.</p>{error && <p className="error">{error}</p>}</div>}</div>;
}
