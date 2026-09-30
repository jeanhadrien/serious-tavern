import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Character, NodeTypeDescriptor, Preset } from '@st/shared';
import { nodeTypesApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import type { CanvasNode } from './model.js';
import { applyResolvedPorts, portRequests, resolvePortRequests } from './dynamicPorts.js';

export function useDynamicPorts(
  nodes: CanvasNode[],
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>,
  types: NodeTypeDescriptor[],
  presets: Preset[],
  characters: Character[],
  canvasVersion: number,
) {
  const requests = portRequests(nodes);
  const requestKey = JSON.stringify(requests);
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  useEffect(() => {
    let active = true;
    void resolvePortRequests(
      requestsRef.current,
      async (request) => {
        try {
          return await nodeTypesApi.resolvePorts(request.type, request.config, { silent: true });
        } catch (error) {
          if (active) alerts.error(error instanceof Error ? error.message : 'Could not resolve node ports');
          const descriptor = types.find((type) => type.type === request.type)!;
          return { inputs: descriptor.inputs, outputs: descriptor.outputs };
        }
      },
      (request, ports) => setNodes((previous) => (active ? applyResolvedPorts(previous, request, ports) : previous)),
      () => active,
    );
    return () => {
      active = false;
    };
  }, [requestKey, types, presets, characters, canvasVersion, setNodes]);
}
