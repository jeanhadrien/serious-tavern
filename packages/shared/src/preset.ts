import { z } from 'zod';

export const slotKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9_]*$/, 'Input key must start with a lowercase letter and contain only letters, digits or underscores');
export const presetRoleSchema = z.enum(['system', 'user', 'assistant']);
export const presetInputSchema = z.object({
  key: slotKeySchema,
  name: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  dataType: z.enum(['messages', 'text']),
  description: z.string().optional()
});
export const presetEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1), name: z.string().min(1), enabled: z.boolean(), kind: z.literal('message'),
    role: presetRoleSchema, content: z.string(),
    placement: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('ordered') }),
      z.object({ mode: z.literal('depth'), inputKey: slotKeySchema, depth: z.number().int().nonnegative() })
    ]).default({ mode: 'ordered' })
  }),
  z.object({
    id: z.string().min(1), name: z.string().min(1), enabled: z.boolean(), kind: z.literal('input'),
    inputKey: slotKeySchema, role: presetRoleSchema.default('user')
  })
]);
export const presetSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1), description: z.string().optional(),
  inputs: z.array(presetInputSchema).default([]), entries: z.array(presetEntrySchema),
  createdAt: z.string(), updatedAt: z.string()
}).superRefine((preset, ctx) => {
  const inputByKey = new Map<string, (typeof preset.inputs)[number]>();
  const ids = new Set<string>();
  const usedInputEntries = new Set<string>();
  preset.inputs.forEach((input, index) => {
    if (inputByKey.has(input.key))
      ctx.addIssue({ code: 'custom', path: ['inputs', index, 'key'], message: `Duplicate input key: ${input.key}` });
    inputByKey.set(input.key, input);
  });
  preset.entries.forEach((entry, index) => {
    if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', path: ['entries', index, 'id'], message: `Duplicate entry id: ${entry.id}` });
    ids.add(entry.id);
    if (entry.kind !== 'input') return;
    const input = inputByKey.get(entry.inputKey);
    if (!input) {
      ctx.addIssue({ code: 'custom', path: ['entries', index, 'inputKey'], message: `Unknown input: ${entry.inputKey}` });
      return;
    }
    if (entry.enabled && !input.enabled)
      ctx.addIssue({ code: 'custom', path: ['entries', index, 'inputKey'], message: `Enabled entry references disabled input: ${entry.inputKey}` });
    if (entry.enabled && usedInputEntries.has(entry.inputKey))
      ctx.addIssue({ code: 'custom', path: ['entries', index, 'inputKey'], message: `Input is placed more than once: ${entry.inputKey}` });
    if (entry.enabled) usedInputEntries.add(entry.inputKey);
  });
  preset.entries.forEach((entry, index) => {
    if (entry.kind !== 'message' || entry.placement.mode !== 'depth') return;
    const input = inputByKey.get(entry.placement.inputKey);
    if (!input || !input.enabled || input.dataType !== 'messages' || !usedInputEntries.has(input.key)) {
      ctx.addIssue({ code: 'custom', path: ['entries', index, 'placement', 'inputKey'],
        message: `Depth placement requires an enabled messages input placed by an enabled entry: ${entry.placement.inputKey}` });
    }
  });
});
export type Preset = z.infer<typeof presetSchema>;
export type PresetInput = z.infer<typeof presetInputSchema>;
export type PresetEntry = z.infer<typeof presetEntrySchema>;
export type PromptMessage = { role: z.infer<typeof presetRoleSchema>; content: string };

export function presetWarnings(preset: Preset): string[] {
  const warnings: string[] = [];
  const activeInputs = new Set(preset.inputs.filter(input => input.enabled).map(input => input.key));
  const placedInputs = new Set(preset.entries.filter((entry): entry is Extract<PresetEntry, { kind: 'input' }> =>
    entry.kind === 'input' && entry.enabled).map(entry => entry.inputKey));
  for (const input of preset.inputs) {
    if (input.enabled && !placedInputs.has(input.key))
      warnings.push(`Input "${input.key}" is enabled but is not placed in the message list.`);
  }
  for (const entry of preset.entries) {
    if (!entry.enabled || entry.kind !== 'message') continue;
    for (const [, key] of entry.content.matchAll(/\{\{\s*input\.([a-zA-Z0-9_]+)\s*\}\}/g)) {
      if (!activeInputs.has(key!)) warnings.push(`Message "${entry.name}" references unavailable input "${key}".`);
    }
  }
  if (!preset.entries.some(entry => entry.enabled))
    warnings.push('No entries are enabled, so this preset will render no messages.');
  return [...new Set(warnings)];
}
