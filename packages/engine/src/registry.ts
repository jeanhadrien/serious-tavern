import { z } from 'zod';
import type { NodeTypeDescriptor } from '@st/shared';
import { isSink, type NodeDefinition } from './types.js';
import { chatInput } from './nodes/chat-input/index.js';
import { chatOutput } from './nodes/chat-output/index.js';
import { llm } from './nodes/llm/index.js';
import { httpRequest } from './nodes/http-request/index.js';
import { condition } from './nodes/condition/index.js';
import { merge } from './nodes/merge/index.js';
import { memory } from './nodes/memory/index.js';
import { character } from './nodes/character/index.js';
import { chatSettings } from './nodes/chat-settings/index.js';
import { random } from './nodes/random/index.js';
import { parseJson } from './nodes/parse-json/index.js';
import { recall } from './nodes/recall/index.js';
import { draw } from './nodes/draw/index.js';
import { stateRead } from './nodes/state-read/index.js';
import { stateWrite } from './nodes/state-write/index.js';
import { nextChunk } from './nodes/next-chunk/index.js';
import { unlinkedMessages } from './nodes/unlinked-messages/index.js';
import { thread } from './nodes/thread/index.js';
import { trigger } from './nodes/trigger/index.js';
import { pickFields } from './nodes/pick-fields/index.js';
import { textStatsNode } from './nodes/text-stats/index.js';

// Register a new backend node here; the UI uses its descriptor and generic editor automatically.
export const registry = new Map<string, NodeDefinition>(
  [
    chatInput,
    chatOutput,
    character,
    chatSettings,
    llm,
    httpRequest,
    condition,
    merge,
    memory,
    random,
    parseJson,
    recall,
    draw,
    stateRead,
    stateWrite,
    nextChunk,
    unlinkedMessages,
    thread,
    trigger,
    pickFields,
    textStatsNode,
  ].map((node) => [node.type, node]),
);
const describe = (definition: NodeDefinition): NodeTypeDescriptor => ({
  type: definition.type,
  label: definition.label,
  description: definition.description,
  category: definition.category,
  dynamicPorts: !!definition.resolvePorts,
  // Descriptors are static: a sink that depends on its config is described with the default config.
  sink: isSink(definition, definition.defaultConfig),
  inputs: definition.inputs,
  outputs: definition.outputs,
  templateFields: definition.templateFields,
  configSchema: z.toJSONSchema(definition.configSchema) as Record<string, unknown>,
  defaultConfig: definition.defaultConfig,
});

/** The descriptor of every node type, the node catalog. */
export function descriptors(): NodeTypeDescriptor[] {
  return [...registry.values()].map(describe);
}

/** The descriptor of one node type, or undefined when the type is unknown. */
export function descriptor(type: string): NodeTypeDescriptor | undefined {
  const definition = registry.get(type);
  return definition && describe(definition);
}
