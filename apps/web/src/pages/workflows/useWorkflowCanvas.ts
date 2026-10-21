import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { Workflow, NodeTypeDescriptor, NodeInstance, Preset, Character, StateDefinition } from '@st/shared';
import { alerts } from '../../alerts/index.js';
import { checkConnection } from '../../connection.js';
import { withDisplayNames, workflowToCanvas, type CanvasNode } from './model.js';
import { useCanvasClipboard } from './useCanvasClipboard.js';
import { useCanvasHistory } from './useCanvasHistory.js';
import { FALLBACK_NODE_SIZE, tidyLayout } from './tidyLayout.js';
import { useConnectPicker } from './useConnectPicker.js';
import { useDynamicPorts } from './useDynamicPorts.js';

export function useWorkflowCanvas(
  types: NodeTypeDescriptor[],
  presets: Preset[],
  characters: Character[],
  stateDefinitions: StateDefinition[],
) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<string>();
  const [highlightedEdge, setHighlightedEdge] = useState<string>();
  // A node a link asked to show: selected and fitted once the canvas has measured it (`ShowNode`), then forgotten.
  const [nodeToShow, setNodeToShow] = useState<string>();
  const [canvasVersion, setCanvasVersion] = useState(0);
  // Ports depend on what the node reads from presets, characters and state definitions: they are resolved
  // again when any of those lists changes.
  useDynamicPorts(nodes, setNodes, edges, setEdges, types, presets, characters, stateDefinitions, canvasVersion);
  // The config panel closes when undo takes its node away.
  const history = useCanvasHistory({
    nodes,
    edges,
    setNodes,
    setEdges,
    onRestore: ({ nodes: restored }) =>
      setSelected((prev) => (prev && restored.some((node) => node.id === prev) ? prev : undefined)),
  });
  const canvasRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, deleteElements, fitView } = useReactFlow();
  const load = (next: Workflow) => {
    history.reset();
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
    history.reset();
    setCanvasVersion((version) => version + 1);
    setNodes([]);
    setEdges([]);
    setSelected(undefined);
    setHighlightedEdge(undefined);
  };
  // Only removals are steps here: selection, measurements and drags (recorded on drag stop) are not.
  const { record } = history;
  const onNodesChange: OnNodesChange<CanvasNode> = useCallback(
    (changes) => {
      const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
      if (removed.length) record();
      setNodes((prev) => applyNodeChanges(changes, prev));
      if (removed.length) {
        setEdges((prev) => prev.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)));
        setSelected((prev) => (prev && removed.includes(prev) ? undefined : prev));
      }
    },
    [record],
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      if (changes.some((change) => change.type === 'remove')) record();
      setEdges((prev) => applyEdgeChanges(changes, prev));
    },
    [record],
  );
  // The edge rules of a manual connection: one edge per target handle, a new one replaces the old.
  const linkEdge = useCallback(
    (connection: Connection) => {
      record();
      setEdges((prev) =>
        addEdge(
          { ...connection, id: crypto.randomUUID() },
          prev.filter((e) => e.target !== connection.target || e.targetHandle !== connection.targetHandle),
        ),
      );
    },
    [record],
  );
  const connect = useCallback(
    (connection: Connection) => {
      if (!connection.sourceHandle || !connection.targetHandle) return;
      const result = checkConnection(connection, nodes);
      if (!result.ok) {
        alerts.info(result.reason);
        return;
      }
      linkEdge(connection);
    },
    [nodes, linkEdge],
  );
  // Returns the new node's id, for callers that connect it right away.
  const addNode = (descriptor: NodeTypeDescriptor, position: { x: number; y: number }): string => {
    const id = crypto.randomUUID();
    record();
    setNodes((prev) =>
      withDisplayNames(
        [
          ...prev,
          {
            id,
            type: 'workflow',
            position,
            data: { descriptor, config: { ...descriptor.defaultConfig }, name: descriptor.label },
          },
        ],
        types,
      ),
    );
    return id;
  };
  const clipboard = useCanvasClipboard({ nodes, edges, types, setNodes, setEdges, setSelected, record });
  const picker = useConnectPicker({ nodes, types, canvasRef, addNode, linkEdge });
  // Another workflow was loaded (or the canvas cleared): the drop point no longer means anything.
  useEffect(picker.close, [canvasVersion]);
  const onConnectEnd: React.ComponentProps<typeof ReactFlow>['onConnectEnd'] = (event, state) => {
    if (picker.open(event, state)) return;
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
  // The quick add: the picker listing every type, from a double-click on empty canvas or `/`. `/` opens it where the
  // pointer last was over the canvas, else at the centre.
  const pointer = useRef<{ x: number; y: number }>(undefined);
  const trackPointer = (event: React.PointerEvent) => {
    pointer.current = { x: event.clientX, y: event.clientY };
  };
  const forgetPointer = () => {
    pointer.current = undefined;
  };
  const quickAdd = (): boolean => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return picker.openAt(pointer.current ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };
  // Only the pane itself counts: a node, an edge, a control or a panel is another target.
  const onDoubleClick = (event: React.MouseEvent) => {
    if (event.target instanceof Element && event.target.classList.contains('react-flow__pane'))
      picker.openAt({ x: event.clientX, y: event.clientY });
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
  // Tidy: every node gets a new position in one undo step, then the view fits the result.
  const tidy = () => {
    if (!nodes.length) return;
    const positions = tidyLayout(
      nodes.map((node) => ({
        id: node.id,
        width: node.measured?.width ?? FALLBACK_NODE_SIZE.width,
        height: node.measured?.height ?? FALLBACK_NODE_SIZE.height,
      })),
      edges,
    );
    record();
    setNodes((prev) =>
      prev.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
      }),
    );
    // The fit has to wait until React Flow has the new positions.
    requestAnimationFrame(() => void fitView({ duration: 200 }));
  };
  // The selection as an on-screen action, for touch screens where the Delete key is out of reach. It goes through
  // the same change handlers as the key, so a removed node takes its edges with it.
  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedEdges = edges.filter((edge) => edge.selected);
  const hasSelection = selectedNodes.length > 0 || selectedEdges.length > 0;
  const deleteSelection = () => void deleteElements({ nodes: selectedNodes, edges: selectedEdges });
  // Selects what an issue names and fits the view to it. Selection is not part of the draft, so this is no step.
  const focusIssue = (nodeIds: readonly string[], edgeId?: string) => {
    const ids = new Set(nodeIds);
    setSelected(undefined);
    setNodes((prev) =>
      prev.map((node) => (node.selected === ids.has(node.id) ? node : { ...node, selected: ids.has(node.id) })),
    );
    setEdges((prev) =>
      prev.map((edge) => (!!edge.selected === (edge.id === edgeId) ? edge : { ...edge, selected: edge.id === edgeId })),
    );
    if (ids.size)
      requestAnimationFrame(() => void fitView({ nodes: [...ids].map((id) => ({ id })), duration: 300, maxZoom: 1 }));
  };
  // Clears the node whose config is open and the canvas selection (the highlight is not part of the draft).
  const deselect = () => {
    setSelected(undefined);
    setNodes((prev) =>
      prev.some((node) => node.selected) ? prev.map((node) => ({ ...node, selected: false })) : prev,
    );
    setEdges((prev) =>
      prev.some((edge) => edge.selected) ? prev.map((edge) => ({ ...edge, selected: false })) : prev,
    );
  };
  const deleteNode = (id: string) => void deleteElements({ nodes: [{ id }] });
  const current = nodes.find((n) => n.id === selected);
  // Changes to one node's config that follow each other closely are a single step.
  const updateConfig = (config: NodeInstance['config']) => {
    if (selected) record(undefined, `config:${selected}`);
    setNodes((prev) => prev.map((n) => (n.id === selected ? { ...n, data: { ...n.data, config } } : n)));
  };
  return {
    nodes,
    edges,
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
    picker: picker.picker,
    pickCandidate: picker.pick,
    closePicker: picker.close,
    quickAdd,
    onDoubleClick,
    trackPointer,
    forgetPointer,
    addAtCenter,
    tidy,
    onDrop,
    updateConfig,
    hasSelection,
    deselect,
    focusIssue,
    nodeToShow,
    showNode: setNodeToShow,
    deleteSelection,
    deleteNode,
    copy: clipboard.copy,
    paste: clipboard.paste,
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    recordStep: history.record,
    onDragStart: history.onDragStart,
    onDragStop: history.onDragStop,
  };
}
