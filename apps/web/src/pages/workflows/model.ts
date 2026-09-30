import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react';
import type { Edge, NodeInstance, NodeTypeDescriptor, Workflow } from '@st/shared';

export type CanvasNode = FlowNode<{
  descriptor: NodeTypeDescriptor;
  config: NodeInstance['config'];
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
  const nodes = workflow.nodes.map((node) => {
    const descriptor = types.find((type) => type.type === node.type);
    if (descriptor)
      return {
        id: node.id,
        type: 'workflow',
        position: node.position,
        data: { descriptor, config: node.config },
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
