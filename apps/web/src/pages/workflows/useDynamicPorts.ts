import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Edge } from '@xyflow/react';
import type { Character, NodeTypeDescriptor, Preset, StateDefinition } from '@st/shared';
import { nodeTypesApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import type { CanvasNode } from './model.js';
import { applyResolvedPorts, createPortErrors, portRequests, resolvePortRequests } from './dynamicPorts.js';

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
  const [portErrors] = useState(() => createPortErrors(alerts));
  const requests = portRequests(nodes);
  const requestKey = JSON.stringify(requests);
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  // Errors of nodes that are gone, or of a workflow that was closed, do not stay on screen.
  useEffect(() => () => portErrors.keepOnly(new Set()), [portErrors]);
  useEffect(() => {
    let active = true;
    portErrors.keepOnly(new Set(requestsRef.current.map((request) => request.id)));
    void resolvePortRequests(
      requestsRef.current,
      async (request) => {
        try {
          return await nodeTypesApi.resolvePorts(request.type, request.config, { silent: true });
        } catch (error) {
          if (active)
            portErrors.failed(
              request.id,
              error instanceof Error ? error.message : 'Could not resolve node ports',
              request.unset.length === 0,
            );
          return undefined;
        }
      },
      (request, ports) => {
        if (!active) return;
        portErrors.resolved(request.id);
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
  }, [requestKey, types, presets, characters, stateDefinitions, canvasVersion, setNodes, setEdges, portErrors]);
}
