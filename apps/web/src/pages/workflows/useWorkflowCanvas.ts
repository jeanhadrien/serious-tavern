import { useCallback, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  type Edge,
  type ReactFlow,
} from '@xyflow/react';
import {
  nodeDisplayName,
  type Workflow,
  type NodeTypeDescriptor,
  type NodeInstance,
  type Preset,
  type Character,
} from '@st/shared';
import { alerts } from '../../alerts/index.js';
import { checkConnection } from '../../connection.js';
import { workflowToCanvas, type CanvasNode } from './model.js';
import { useDynamicPorts } from './useDynamicPorts.js';

export function useWorkflowCanvas(types: NodeTypeDescriptor[], presets: Preset[], characters: Character[]) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<string>();
  const [highlightedEdge, setHighlightedEdge] = useState<string>();
  const [canvasVersion, setCanvasVersion] = useState(0);
  useDynamicPorts(nodes, setNodes, edges, setEdges, types, presets, characters, canvasVersion);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, deleteElements } = useReactFlow();
  const visibleEdges = useMemo(
    () =>
      edges.map((edge) => {
        const result = checkConnection(edge, nodes);
        const highlighted = edge.id === highlightedEdge;
        return {
          ...edge,
          label: !result.ok ? 'incompatible' : result.coerce ? '→text' : undefined,
          labelStyle: { fill: highlighted || !result.ok ? '#ff8b93' : '#efcf9b', fontSize: 11 },
          animated: highlighted || undefined,
          style: highlighted
            ? { stroke: '#ef8186', strokeWidth: 3 }
            : !result.ok
              ? { stroke: '#ef8186', strokeWidth: 2 }
              : result.coerce
                ? { stroke: '#e6bb77', strokeWidth: 2, strokeDasharray: '6 4' }
                : undefined,
        };
      }),
    [edges, nodes, highlightedEdge],
  );
  const load = (next: Workflow) => {
    setCanvasVersion((version) => version + 1);
    const canvas = workflowToCanvas(next, types);
    setNodes(canvas.nodes);
    setEdges(canvas.edges);
    setSelected(undefined);
    setHighlightedEdge(undefined);
    if (canvas.unknownTypes.length)
      alerts.warning(`Unknown node types are preserved read-only: ${canvas.unknownTypes.join(', ')}`);
  };
  const clear = () => {
    setCanvasVersion((version) => version + 1);
    setNodes([]);
    setEdges([]);
    setSelected(undefined);
    setHighlightedEdge(undefined);
  };
  const onNodesChange: OnNodesChange<CanvasNode> = useCallback((changes) => {
    setNodes((prev) => applyNodeChanges(changes, prev));
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (removed.length) {
      setEdges((prev) => prev.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)));
      setSelected((prev) => (prev && removed.includes(prev) ? undefined : prev));
    }
  }, []);
  const onEdgesChange: OnEdgesChange = useCallback((changes) => {
    setEdges((prev) => applyEdgeChanges(changes, prev));
  }, []);
  const connect = useCallback(
    (connection: Connection) => {
      if (!connection.sourceHandle || !connection.targetHandle) return;
      const result = checkConnection(connection, nodes);
      if (!result.ok) {
        alerts.info(result.reason);
        return;
      }
      setEdges((prev) =>
        addEdge(
          { ...connection, id: crypto.randomUUID() },
          prev.filter((e) => e.target !== connection.target || e.targetHandle !== connection.targetHandle),
        ),
      );
    },
    [nodes],
  );
  const onConnectEnd: React.ComponentProps<typeof ReactFlow>['onConnectEnd'] = (_, state) => {
    if (state.isValid !== false || !state.fromHandle || !state.toHandle) return;
    const source = state.fromHandle.type === 'source' ? state.fromHandle : state.toHandle;
    const target = state.fromHandle.type === 'target' ? state.fromHandle : state.toHandle;
    const result = checkConnection(
      {
        source: source.nodeId,
        sourceHandle: source.id ?? null,
        target: target.nodeId,
        targetHandle: target.id ?? null,
      },
      nodes,
    );
    if (!result.ok) alerts.info(result.reason);
  };
  const addNode = (descriptor: NodeTypeDescriptor, position: { x: number; y: number }) => {
    setNodes((prev) => {
      const next: CanvasNode[] = [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: 'workflow',
          position,
          data: { descriptor, config: { ...descriptor.defaultConfig }, name: descriptor.label },
        },
      ];
      const labelOf = (type: string) => types.find((item) => item.type === type)?.label ?? type;
      const list = next.map((node) => ({ id: node.id, type: node.data.descriptor.type }));
      return next.map((node) => ({ ...node, data: { ...node.data, name: nodeDisplayName(list, labelOf, node.id) } }));
    });
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
    const descriptor = types.find((item) => item.type === type);
    if (descriptor) addNode(descriptor, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };
  // The selection as an on-screen action, for touch screens where the Delete key is out of reach. It goes through
  // the same change handlers as the key, so a removed node takes its edges with it.
  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedEdges = edges.filter((edge) => edge.selected);
  const hasSelection = selectedNodes.length > 0 || selectedEdges.length > 0;
  const deleteSelection = () => void deleteElements({ nodes: selectedNodes, edges: selectedEdges });
  const deleteNode = (id: string) => void deleteElements({ nodes: [{ id }] });
  const current = nodes.find((n) => n.id === selected);
  const updateConfig = (config: NodeInstance['config']) => {
    setNodes((prev) => prev.map((n) => (n.id === selected ? { ...n, data: { ...n.data, config } } : n)));
  };
  return {
    nodes,
    edges,
    visibleEdges,
    canvasVersion,
    current,
    canvasRef,
    setSelected,
    highlightedEdge,
    setHighlightedEdge,
    load,
    clear,
    onNodesChange,
    onEdgesChange,
    connect,
    onConnectEnd,
    addAtCenter,
    onDrop,
    updateConfig,
    hasSelection,
    deleteSelection,
    deleteNode,
  };
}
