import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react';
import {
  nodeDisplayName,
  workflowSettings,
  type ApiBody,
  type Edge,
  type NodeInstance,
  type NodeTypeDescriptor,
  type Workflow,
} from '@st/shared';

export type CanvasNode = FlowNode<{
  descriptor: NodeTypeDescriptor;
  config: NodeInstance['config'];
  name: string;
  unknown?: boolean;
}>;

export function workflowToCanvas(
  workflow: Workflow,
  types: NodeTypeDescriptor[],
): {
  nodes: CanvasNode[];
  edges: FlowEdge[];
  unknownTypes: string[];
} {
  const labelOf = (type: string) => types.find((item) => item.type === type)?.label ?? type;
  const nodes = workflow.nodes.map((node) => {
    const descriptor = types.find((type) => type.type === node.type);
    const name = nodeDisplayName(workflow.nodes, labelOf, node.id);
    if (descriptor)
      return {
        id: node.id,
        type: 'workflow',
        position: node.position,
        data: { descriptor, config: node.config, name },
      } satisfies CanvasNode;
    const inputs = [
      ...new Set(workflow.edges.filter((edge) => edge.target === node.id).map((edge) => edge.targetHandle)),
    ];
    const outputs = [
      ...new Set(workflow.edges.filter((edge) => edge.source === node.id).map((edge) => edge.sourceHandle)),
    ];
    return {
      id: node.id,
      type: 'workflow',
      position: node.position,
      data: {
        unknown: true,
        config: node.config,
        name,
        descriptor: {
          type: node.type,
          label: `Unknown node type: ${node.type}`,
          description: 'This node type is not currently available. Its configuration is preserved as read-only.',
          category: 'Unknown',
          dynamicPorts: false,
          inputs: inputs.map((name) => ({ name, label: name, dataType: 'any' as const })),
          outputs: outputs.map((name) => ({ name, label: name, dataType: 'any' as const })),
          configSchema: {},
          defaultConfig: {},
        },
      },
    } satisfies CanvasNode;
  });
  return {
    nodes,
    edges: workflow.edges.map((edge) => ({ ...edge })),
    unknownTypes: [
      ...new Set(
        workflow.nodes.filter((node) => !types.some((type) => type.type === node.type)).map((node) => node.type),
      ),
    ],
  };
}

/** Gives every node its display name (`Label #k (type)`): numbered among the nodes of its type, in array order. */
export function withDisplayNames(nodes: CanvasNode[], types: NodeTypeDescriptor[]): CanvasNode[] {
  const labelOf = (type: string) => types.find((item) => item.type === type)?.label ?? type;
  const list = nodes.map((node) => ({ id: node.id, type: node.data.descriptor.type }));
  return nodes.map((node) => ({ ...node, data: { ...node.data, name: nodeDisplayName(list, labelOf, node.id) } }));
}

export function canvasToWorkflow(workflow: Workflow, nodes: CanvasNode[], edges: FlowEdge[]): Workflow {
  return {
    ...workflow,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.descriptor.type,
      config: node.data.config,
      position: node.position,
    })),
    edges: edges.map(
      (edge) =>
        ({
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.sourceHandle ?? '',
          target: edge.target,
          targetHandle: edge.targetHandle ?? '',
        }) as Edge,
    ),
  };
}

/**
 * The draft as the validate endpoint takes it. The draft keeps chat settings declarations that don't parse (the
 * settings panel shows them), and the endpoint would answer 400 to those, so only the ones that parse are sent.
 */
export function canvasToDraftBody(
  workflow: Workflow,
  nodes: CanvasNode[],
  edges: FlowEdge[],
): ApiBody<'validateWorkflowDraft'> {
  const draft = canvasToWorkflow(workflow, nodes, edges);
  return { nodes: draft.nodes, edges: draft.edges, settings: workflowSettings(draft) };
}
