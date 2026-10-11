import { z } from 'zod';
import { portDataTypes } from './ports.js';
export const validationIssueSchema = z.object({
  message: z.string(),
  edgeId: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
});
// Stored records preserve unknown fields (passthrough) so forward-compatible reads
// never drop data added by newer versions; writes migrate-on-write via these schemas.
export const nodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
    position: z.object({ x: z.number(), y: z.number() }),
  })
  .passthrough();
export const edgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    sourceHandle: z.string().min(1),
    target: z.string().min(1),
    targetHandle: z.string().min(1),
  })
  .passthrough();
export const workflowSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    nodes: z.array(nodeSchema),
    edges: z.array(edgeSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();
export const messageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    createdAt: z.string(),
    executionId: z.string().optional(),
    name: z.string().optional(),
    characterId: z.string().optional(),
    // `streaming` while a turn runs; `partial` when stopped early; `final` once complete.
    status: z.enum(['final', 'streaming', 'partial']).optional(),
    // Stored for display only; reasoning never enters prompt content.
    reasoning: z.string().optional(),
    nodeId: z.string().optional(),
  })
  .passthrough();
export const sessionSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    workflowId: z.string(),
    messages: z.array(messageSchema),
    characterId: z.string().optional(),
    personaId: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();
export const nodeExecutionSchema = z
  .object({
    status: z.enum(['running', 'completed', 'skipped', 'cancelled', 'error']),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    durationMs: z.number().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    request: z.unknown().optional(),
  })
  .passthrough();
export const executionLogSchema = z
  .object({
    id: z.string(),
    workflowId: z.string(),
    sessionId: z.string(),
    status: z.enum(['running', 'completed', 'error']),
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    nodes: z.record(z.string(), nodeExecutionSchema),
    warnings: z.array(z.string()).default([]),
  })
  .passthrough();
export const dataTypeSchema = z.enum(portDataTypes);
export const portSchema = z.object({
  name: z.string(),
  label: z.string(),
  dataType: dataTypeSchema.default('any'),
  description: z.string().optional(),
  required: z.boolean().optional(),
  optional: z.boolean().optional(),
});
export const nodeTypeDescriptorSchema = z.object({
  type: z.string(),
  label: z.string(),
  description: z.string(),
  category: z.string(),
  dynamicPorts: z.boolean(),
  inputs: z.array(portSchema),
  outputs: z.array(portSchema),
  configSchema: z.record(z.string(), z.unknown()),
  defaultConfig: z.record(z.string(), z.unknown()),
  templateFields: z.array(z.string()).optional(),
});
export type Workflow = z.infer<typeof workflowSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type NodeInstance = z.infer<typeof nodeSchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type ChatMessage = z.infer<typeof messageSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type ExecutionLog = z.infer<typeof executionLogSchema>;
export type NodeTypeDescriptor = z.infer<typeof nodeTypeDescriptorSchema>;
