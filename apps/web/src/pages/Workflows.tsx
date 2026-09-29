import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position, useConnection, useReactFlow,
  addEdge, applyNodeChanges, applyEdgeChanges,
  type Connection, type NodeProps, type OnNodesChange, type OnEdgesChange
} from '@xyflow/react';
import { canConnect, portDataTypes, type PortDataType, type PortDef } from '@st/shared/ports';
import type { Workflow, NodeTypeDescriptor, NodeInstance } from '@st/shared';
import { NodeConfigPanel } from '@st/node-ui';
import { Link } from 'react-router-dom';
import type { Preset } from '@st/shared';
import { api, getNodeTypes, getWorkflows, getPresets, getProviders, resolvePorts, json } from '../api.js';
import { alerts } from '../alerts/index.js';
import { checkConnection } from '../connection.js';
import { canvasToWorkflow, workflowToCanvas, type CanvasNode } from './workflow-model.js';

const portColors: Record<PortDataType, string> = {
  text: '#85c5f0', number: '#efd080', boolean: '#d2a7ef', object: '#80cbaa',
  array: '#e9a98c', messages: '#e5accc', any: '#b3b9c7'
};
function WorkflowNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { descriptor } = data;
  const connection = useConnection<CanvasNode>();
  const incompatible = (port: PortDef, type: 'source' | 'target') => {
    if (!connection.inProgress || !connection.fromHandle || connection.fromHandle.nodeId === id) return false;
    const start = connection.fromHandle;
    if (start.type === type) return true;
    const startPort = (start.type === 'source' ? connection.fromNode?.data.descriptor.outputs :
      connection.fromNode?.data.descriptor.inputs)?.find(item => item.name === start.id);
    if (!startPort) return false;
    return !(type === 'target' ? canConnect(startPort, port) : canConnect(port, startPort)).ok;
  };
  const tooltip = (port: PortDef) => `${port.label} (${port.dataType})${port.description ? ` — ${port.description}` : ''}`;
  return <div className={`flow-node ${selected ? 'selected' : ''} ${data.unknown ? 'unknown-node' : ''}`}>
    <strong>{descriptor.label}</strong><small>{descriptor.category}</small>
    {descriptor.inputs.map(port => <div className="port input-port" key={port.name} title={tooltip(port)}>
      <Handle type="target" id={port.name} position={Position.Left}
        className={incompatible(port, 'target') ? 'invalid-handle' : ''}
        style={{ top: '50%', background: incompatible(port, 'target') ? '#ef8186' : portColors[port.dataType] }} />
      {port.label}<span className="port-type">{port.dataType}</span></div>)}
    {descriptor.outputs.map(port => <div className="port output-port" key={port.name} title={tooltip(port)}>
      <span className="port-type">{port.dataType}</span>{port.label}
      <Handle type="source" id={port.name} position={Position.Right}
        className={incompatible(port, 'source') ? 'invalid-handle' : ''}
        style={{ top: '50%', background: incompatible(port, 'source') ? '#ef8186' : portColors[port.dataType] }} /></div>)}
  </div>;
}
const nodeTypes = { workflow: WorkflowNode };

export function Workflows() {
  return <ReactFlowProvider><WorkflowEditor /></ReactFlowProvider>;
}

function WorkflowEditor() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [types, setTypes] = useState<NodeTypeDescriptor[]>([]);
  const [typesReady, setTypesReady] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [providersList, setProvidersList] = useState<{ id: string; label: string }[]>([]);
  const [workflow, setWorkflow] = useState<Workflow>();
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<import('@xyflow/react').Edge[]>([]);
  const [selected, setSelected] = useState<string>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const visibleEdges = useMemo(() => edges.map(edge => {
    const result = checkConnection(edge, nodes);
    return {
      ...edge,
      label: !result.ok ? 'incompatible' : result.coerce ? '→text' : undefined,
      labelStyle: { fill: result.ok ? '#efcf9b' : '#ff8b93', fontSize: 11 },
      style: !result.ok ? { stroke: '#ef8186', strokeWidth: 2 } :
        result.coerce ? { stroke: '#e6bb77', strokeWidth: 2, strokeDasharray: '6 4' } : undefined
    };
  }), [edges, nodes]);
  const refresh = () => getWorkflows().then(setWorkflows);
  useEffect(() => { void refresh().catch(() => {}); void getNodeTypes().then(setTypes).catch(() => {}).finally(() => setTypesReady(true));
    void getPresets().then(setPresets).catch(() => {}); void getProviders().then(setProvidersList).catch(() => {});
  }, []);
  const llmConfigs = JSON.stringify(nodes.filter(node => node.data.descriptor.type === 'llm')
    .map(node => [node.id, node.data.config.presetId]));
  useEffect(() => {
    let active = true;
    void Promise.all(nodes.filter(node => node.data.descriptor.type === 'llm')
      .map(async node => {
        if (!node.data.config.presetId) return undefined;
        try { return { id: node.id, ports: await resolvePorts('llm', node.data.config) }; }
        catch { return { id: node.id, ports: { inputs: [], outputs: node.data.descriptor.outputs } }; }
      })).then(results => {
        if (!active) return;
        setNodes(previous => previous.map(node => {
          const result = results.find(item => item?.id === node.id);
          if (!result || JSON.stringify(node.data.descriptor.inputs) === JSON.stringify(result.ports.inputs)) return node;
          return { ...node, data: { ...node.data, descriptor: { ...node.data.descriptor, ...result.ports } } };
        }));
      });
    return () => { active = false; };
  }, [llmConfigs, presets]);
  useEffect(() => {
    const update = () => { void getPresets().then(setPresets).catch(() => {}); };
    window.addEventListener('focus', update);
    return () => window.removeEventListener('focus', update);
  }, []);
  const load = (next: Workflow) => {
    setWorkflow(next);
    const canvas = workflowToCanvas(next, types);
    setNodes(canvas.nodes);
    setEdges(canvas.edges);
    setSelected(undefined);
    if (canvas.unknownTypes.length)
      alerts.warning(`Unknown node types are preserved read-only: ${canvas.unknownTypes.join(', ')}`);
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
    const result = checkConnection(connection, nodes);
    if (!result.ok) { alerts.info(result.reason); return; }
    setEdges(prev => addEdge({ ...connection, id: crypto.randomUUID() },
      prev.filter(e => e.target !== connection.target || e.targetHandle !== connection.targetHandle)));
  }, [nodes]);
  const onConnectEnd: React.ComponentProps<typeof ReactFlow>['onConnectEnd'] = (_, state) => {
    if (state.isValid !== false || !state.fromHandle || !state.toHandle) return;
    const source = state.fromHandle.type === 'source' ? state.fromHandle : state.toHandle;
    const target = state.fromHandle.type === 'target' ? state.fromHandle : state.toHandle;
    const result = checkConnection({ source: source.nodeId, sourceHandle: source.id ?? null,
      target: target.nodeId, targetHandle: target.id ?? null }, nodes);
    if (!result.ok) alerts.info(result.reason);
  };
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
    if (!typesReady) return;
    const name = window.prompt('Workflow name');
    if (!name?.trim()) return;
    try { const created = await api<Workflow>('/workflows', json('POST', { name })); await refresh(); load(created); }
    catch { /* API errors are toasted. */ }
  };
  const save = async (showToast = true): Promise<boolean> => {
    if (!workflow) return false;
    const current = canvasToWorkflow(workflow, nodes, edges);
    try { const updated = await api<Workflow>(`/workflows/${workflow.id}`, json('PUT', current));
      setWorkflow(prev => prev?.id === updated.id ? { ...prev, updatedAt: updated.updatedAt } : prev);
      if (showToast) alerts.success('Workflow saved');
      await refresh(); return true; }
    catch { return false; }
  };
  const validate = async () => {
    if (!workflow) return;
    try {
      if (!await save(false)) return;
      await api(`/workflows/${workflow.id}/validate`, json('POST'));
      alerts.success('Workflow is valid');
    } catch { /* API errors are toasted. */ }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this workflow?')) return;
    try { await api(`/workflows/${id}`, json('DELETE'));
      if (workflow?.id === id) { setWorkflow(undefined); setNodes([]); setEdges([]); setSelected(undefined); }
      await refresh(); }
    catch { /* API errors are toasted. */ }
  };
  const current = nodes.find(n => n.id === selected);
  const currentDescriptor = current?.data.descriptor;
  const selectedPreset = presets.find(preset => preset.id === current?.data.config.presetId);
  const updateConfig = (config: NodeInstance['config']) => {
    setNodes(prev => prev.map(n => n.id === selected ? { ...n, data: { ...n.data, config } } : n));
  };
  return <div className="workflow-layout"><aside className="sidebar"><div className="toolbar"><h2>Workflows</h2>
    <button className="primary" disabled={!typesReady} onClick={() => void create()}>+ New</button></div>
    {workflows.map(w => <div key={w.id} className={`session-row ${workflow?.id === w.id ? 'selected' : ''}`}>
      <button className="session-link" disabled={!typesReady} onClick={() => load(structuredClone(w))}>{w.name}</button>
      <button title="Delete workflow" onClick={() => void remove(w.id)}>×</button></div>)}</aside>
    {workflow ? <div className="editor"><div className="editor-toolbar">
      <input aria-label="Workflow name" value={workflow.name} onChange={e => setWorkflow(prev => prev && ({ ...prev, name: e.target.value }))} />
      <button onClick={() => void validate()}>Validate</button><button className="primary" onClick={() => void save()}>Save</button>
      </div>
      <div className="editor-body"><aside className="palette"><h3>Nodes</h3>{types.map(t =>
        <button title={t.description} key={t.type} draggable onDragStart={event => {
          event.dataTransfer.setData('application/st-node-type', t.type);
          event.dataTransfer.effectAllowed = 'copy';
        }} onClick={() => addAtCenter(t)}><small>{t.category}</small>{t.label} +</button>)}
        <p className="hint">Click to add at center or drag onto the canvas. Drag nodes to move; connect handles; press Delete to remove.</p>
        <div className="port-legend"><h3>Port types</h3>{portDataTypes.map(type =>
          <span key={type}><i style={{ background: portColors[type] }} />{type}</span>)}</div></aside>
        <div className="canvas" ref={canvasRef} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
          onDrop={onDrop}><ReactFlow nodes={nodes} edges={visibleEdges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect} onConnectEnd={onConnectEnd}
          isValidConnection={connection => checkConnection(connection, nodes).ok}
          onNodeClick={(_, node) => setSelected(node.id)} onPaneClick={() => setSelected(undefined)}
          deleteKeyCode={['Backspace', 'Delete']}
          fitView><Background color="#414652" gap={20} /><Controls /></ReactFlow></div>
        {current && currentDescriptor && <aside className="config-panel"><div className="toolbar"><h3>{currentDescriptor.label}</h3>
          <button onClick={() => setSelected(undefined)}>×</button></div><p className="hint">{currentDescriptor.description}</p>
          {current.data.unknown ? <pre className="unknown-config">{JSON.stringify(current.data.config, null, 2)}</pre> :
          currentDescriptor.type === 'llm' ? <div className="config-fields">
            <label>Provider<select value={String(current.data.config.provider ?? 'openrouter')} onChange={e =>
              updateConfig({ ...current.data.config, provider: e.target.value })}>
              {providersList.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
            <label>Model<input value={String(current.data.config.model ?? '')} onChange={e =>
              updateConfig({ ...current.data.config, model: e.target.value })} /></label>
            <label>Preset<select value={String(current.data.config.presetId ?? '')} onChange={e =>
              updateConfig({ ...current.data.config, presetId: e.target.value })}>
              <option value="">Choose a preset</option>{presets.map(preset =>
                <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
            {selectedPreset && <div className="preset-port-summary">
              <small>LLM input ports from this preset</small>
              {selectedPreset.inputs.map(input =>
                <span key={input.id}>{input.key} : {input.dataType}</span>)}
            </div>}
            {Boolean(current.data.config.presetId) && <Link to={`/presets?id=${current.data.config.presetId}`}>Edit preset ↗</Link>}
            <label className="check"><input type="checkbox"
              checked={current.data.config.mergeSystemMessages === true} onChange={e =>
                updateConfig({ ...current.data.config, mergeSystemMessages: e.target.checked })} />
              Merge consecutive system messages</label>
            <p className="hint">Joins adjacent unnamed system messages with a blank line. Named messages stay separate.</p>
            {(['temperature', 'maxTokens', 'topP', 'frequencyPenalty', 'presencePenalty'] as const).map(key =>
              <label key={key}>{key}<input type="number" step={key === 'maxTokens' ? 1 : 0.1}
                value={String(current.data.config[key] ?? '')} onChange={e => {
                  const config = { ...current.data.config };
                  if (e.target.value === '') delete config[key]; else config[key] = Number(e.target.value);
                  updateConfig(config);
                }} /></label>)}
            <label>Stop sequences (one per line)<textarea value={Array.isArray(current.data.config.stop) ?
              current.data.config.stop.join('\n') : ''} onChange={e => updateConfig({ ...current.data.config,
              stop: e.target.value ? e.target.value.split('\n').filter(Boolean) : undefined })} /></label>
          </div> : <NodeConfigPanel descriptor={currentDescriptor} config={current.data.config} onChange={updateConfig} />}</aside>}</div></div> :
      <div className="empty-state"><h1>Build a workflow</h1><p>Choose a workflow or create a new one.</p></div>}</div>;
}
