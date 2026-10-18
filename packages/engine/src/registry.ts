import { z } from 'zod';
import type { NodeTypeDescriptor } from '@st/shared';
import type { NodeDefinition } from './types.js';
import { afterReply } from './nodes/after-reply/index.js';
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
import { trigger } from './nodes/trigger/index.js';

// Register a new backend node here; the UI uses its descriptor and generic editor automatically.
export const registry = new Map<string, NodeDefinition>(
  [
    chatInput,
    chatOutput,
    character,
    chatSettings,
    afterReply,
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
    trigger,
  ].map((node) => [node.type, node]),
);
export function descriptors(): NodeTypeDescriptor[] {
  return [...registry.values()].map(
    ({
      type,
      label,
      description,
      category,
      inputs,
      outputs,
      configSchema,
      defaultConfig,
      templateFields,
      resolvePorts,
      sink,
    }) => ({
      type,
      label,
      description,
      category,
      dynamicPorts: !!resolvePorts,
      sink: !!sink,
      inputs,
      outputs,
      templateFields,
      configSchema: z.toJSONSchema(configSchema) as Record<string, unknown>,
      defaultConfig,
    }),
  );
}
