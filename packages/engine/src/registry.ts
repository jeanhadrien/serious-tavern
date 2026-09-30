import { z } from 'zod';
import type { NodeTypeDescriptor } from '@st/shared';
import type { NodeDefinition } from './types.js';
import { chatInput } from './nodes/chat-input/index.js';
import { chatOutput } from './nodes/chat-output/index.js';
import { llm } from './nodes/llm/index.js';
import { httpRequest } from './nodes/http-request/index.js';
import { condition } from './nodes/condition/index.js';
import { merge } from './nodes/merge/index.js';
import { memory } from './nodes/memory/index.js';
import { character } from './nodes/character/index.js';

// Register a new backend node here; the UI uses its descriptor and generic editor automatically.
export const registry = new Map<string, NodeDefinition>(
  [chatInput, chatOutput, character, llm, httpRequest, condition, merge, memory].map((node) => [node.type, node]),
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
    }) => ({
      type,
      label,
      description,
      category,
      dynamicPorts: !!resolvePorts,
      inputs,
      outputs,
      templateFields,
      configSchema: z.toJSONSchema(configSchema) as Record<string, unknown>,
      defaultConfig,
    }),
  );
}
