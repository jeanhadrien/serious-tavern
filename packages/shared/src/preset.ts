import { z } from 'zod';
import { macroInputKey, templateMacros } from './macros.js';

export const presetRoleSchema = z.enum(['system', 'user', 'assistant']);
export const presetInputKeySchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9_]*$/, 'Input key must match /^[a-z][a-zA-Z0-9_]*$/');
export const presetInputSchema = z.object({
  id: z.string().min(1),
  key: presetInputKeySchema,
  label: z.string().optional(),
  dataType: z.enum(['messages', 'text']),
  description: z.string().optional(),
});

const depthPlacementSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ordered') }),
  z.object({ mode: z.literal('depth'), entryId: z.string().min(1), depth: z.number().int().nonnegative() }),
]);

export const presetEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    enabled: z.boolean(),
    kind: z.literal('message'),
    role: presetRoleSchema,
    content: z.string(),
    placement: depthPlacementSchema.default({ mode: 'ordered' }),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    enabled: z.boolean(),
    kind: z.literal('slot'),
    inputKey: presetInputKeySchema,
    role: presetRoleSchema.default('user'),
  }),
]);

export const presetFieldsSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().optional(),
    inputs: z.array(presetInputSchema),
    entries: z.array(presetEntrySchema),
  })
  .superRefine((preset, ctx) => {
    const inputByKey = new Map(preset.inputs.map((input) => [input.key, input]));
    const inputKeys = new Set<string>();
    preset.inputs.forEach((input, index) => {
      if (inputKeys.has(input.key.toLowerCase()))
        ctx.addIssue({ code: 'custom', path: ['inputs', index, 'key'], message: `Duplicate input key: ${input.key}` });
      inputKeys.add(input.key.toLowerCase());
    });

    const entryById = new Map(preset.entries.map((entry) => [entry.id, entry]));
    const ids = new Set<string>();
    preset.entries.forEach((entry, index) => {
      if (ids.has(entry.id))
        ctx.addIssue({ code: 'custom', path: ['entries', index, 'id'], message: `Duplicate entry id: ${entry.id}` });
      ids.add(entry.id);
      if (entry.kind === 'slot' && !inputByKey.has(entry.inputKey))
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'inputKey'],
          message: `Unknown input: ${entry.inputKey}`,
        });
      if (entry.kind === 'message') {
        for (const macro of templateMacros(entry.content)) {
          const key = macroInputKey(macro.name);
          if (key !== undefined && !inputKeys.has(key))
            ctx.addIssue({ code: 'custom', path: ['entries', index, 'content'], message: `Unknown input: ${key}` });
        }
      }
    });

    preset.entries.forEach((entry, index) => {
      if (entry.kind !== 'message' || entry.placement.mode !== 'depth') return;
      const slot = entryById.get(entry.placement.entryId);
      const input = slot?.kind === 'slot' ? inputByKey.get(slot.inputKey) : undefined;
      if (!slot || slot.kind !== 'slot' || !slot.enabled || !input || input.dataType !== 'messages') {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'placement', 'entryId'],
          message: 'Depth placement must reference an enabled slot entry for a messages input.',
        });
      }
    });
  });

export const presetSchema = presetFieldsSchema.safeExtend({
  id: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Preset = z.infer<typeof presetSchema>;
export type PresetInput = z.infer<typeof presetInputSchema>;
export type PresetEntry = z.infer<typeof presetEntrySchema>;
export const promptMessageSchema = z.object({
  role: presetRoleSchema,
  content: z.string(),
  name: z.string().optional(),
});
export const presetWarningSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
export type PromptMessage = z.infer<typeof promptMessageSchema>;
export type PresetWarning = z.infer<typeof presetWarningSchema>;

export function presetWarnings(preset: Preset): PresetWarning[] {
  const warnings: PresetWarning[] = [];
  preset.inputs.forEach((input, index) => {
    const usedBySlot = preset.entries.some(
      (entry) => entry.kind === 'slot' && entry.enabled && entry.inputKey === input.key,
    );
    const usedByTemplate = preset.entries.some(
      (entry) =>
        entry.kind === 'message' &&
        entry.enabled &&
        templateMacros(entry.content).some((macro) => macroInputKey(macro.name) === input.key.toLowerCase()),
    );
    if (!usedBySlot && !usedByTemplate)
      warnings.push({ path: ['inputs', index], message: `Input "${input.key}" is not used by an enabled entry.` });
  });
  preset.entries.forEach((entry, index) => {
    if (entry.kind !== 'message' || !entry.enabled) return;
    for (const macro of templateMacros(entry.content)) {
      if (!macro.definition)
        warnings.push({ path: ['entries', index, 'content'], message: `Unknown macro: ${macro.expression}` });
    }
  });
  return warnings;
}
