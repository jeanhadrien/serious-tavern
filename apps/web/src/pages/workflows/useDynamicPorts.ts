import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Edge } from '@xyflow/react';
import type { Character, NodeTypeDescriptor, Preset, StateDefinition } from '@st/shared';
import { nodeTypesApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import type { CanvasNode } from './model.js';
import { applyResolvedPorts, portRequests, resolvePortRequests } from './dynamicPorts.js';

export function useDynamicPorts(
  nodes: CanvasNode[],
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>,
  edges: Edge[],
  setEdges: Dispatch<SetStateAction<Edge[]>>,
  types: NodeTypeDescriptor[],
  presets: Preset[],
  characters: Character[],
  stateDefinitions: StateDefinition[],
  canvasVersion: number,
) {
  const requests = portRequests(nodes);
  const requestKey = JSON.stringify(requests);
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  useEffect(() => {
    let active = true;
    void resolvePortRequests(
      requestsRef.current,
      async (request) => {
        try {
          return await nodeTypesApi.resolvePorts(request.type, request.config, { silent: true });
        } catch (error) {
          if (active) alerts.error(error instanceof Error ? error.message : 'Could not resolve node ports');
          return undefined;
        }
      },
      (request, ports) => {
        if (!active) return;
        const result = applyResolvedPorts(nodesRef.current, edgesRef.current, request, ports);
        nodesRef.current = result.nodes;
        edgesRef.current = result.edges;
        setNodes(result.nodes);
        setEdges(result.edges);
      },
      () => active,
    );
    return () => {
      active = false;
    };
  }, [requestKey, types, presets, characters, stateDefinitions, canvasVersion, setNodes, setEdges]);
}
