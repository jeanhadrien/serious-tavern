import { z } from 'zod';

export const slotKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9_]*$/, 'Slot key must start with a lowercase letter and contain only letters, digits or underscores');
export const presetRoleSchema = z.enum(['system', 'user', 'assistant']);
export const presetEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1), name: z.string().min(1), enabled: z.boolean(), kind: z.literal('message'),
    role: presetRoleSchema, content: z.string(),
    placement: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('ordered') }),
      z.object({ mode: z.literal('depth'), slot: slotKeySchema, depth: z.number().int().nonnegative() })
    ]).default({ mode: 'ordered' })
  }),
  z.object({
    id: z.string().min(1), name: z.string().min(1), enabled: z.boolean(), kind: z.literal('slot'),
    key: slotKeySchema, dataType: z.enum(['messages', 'text']), role: presetRoleSchema.default('user')
  })
]);
export const presetSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1), description: z.string().optional(),
  entries: z.array(presetEntrySchema), createdAt: z.string(), updatedAt: z.string()
}).superRefine((preset, ctx) => {
  const keys = new Set<string>();
  const ids = new Set<string>();
  preset.entries.forEach((entry, index) => {
    if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', path: ['entries', index, 'id'], message: `Duplicate entry id: ${entry.id}` });
    ids.add(entry.id);
    if (entry.kind === 'slot') {
      if (keys.has(entry.key)) ctx.addIssue({ code: 'custom', path: ['entries', index, 'key'], message: `Duplicate slot key: ${entry.key}` });
      keys.add(entry.key);
    }
  });
  preset.entries.forEach((entry, index) => {
    if (entry.kind !== 'message' || entry.placement.mode !== 'depth') return;
    const key = entry.placement.slot;
    if (!preset.entries.some(slot => slot.kind === 'slot' && slot.key === key && slot.enabled && slot.dataType === 'messages'))
      ctx.addIssue({ code: 'custom', path: ['entries', index, 'placement', 'slot'],
        message: `Depth placement requires an enabled messages slot: ${entry.placement.slot}` });
  });
});
export type Preset = z.infer<typeof presetSchema>;
export type PresetEntry = z.infer<typeof presetEntrySchema>;
export type PromptMessage = { role: z.infer<typeof presetRoleSchema>; content: string };
