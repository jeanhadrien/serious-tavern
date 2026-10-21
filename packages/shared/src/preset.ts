import { z } from 'zod';
import { findMacro, macroInputKey, templateMacros } from './macros.js';
import { conversationMessageSchema } from './conversation/index.js';
import { importAppSchema } from './imports.js';
import { analyzeTemplate } from './template-analysis.js';

export const presetRoleSchema = z.enum(['system', 'user', 'assistant']);

// Imported presets are read-only copies of one source file. Identity is (installPath, user, file).
export const presetSourceSchema = z
  .object({
    app: importAppSchema,
    installPath: z.string().min(1),
    user: z.string().min(1),
    file: z.string().min(1),
    hash: z.string().regex(/^[a-f0-9]{64}$/, 'Hash must be a sha256 hex digest'),
    importedAt: z.string(),
    missing: z.boolean().optional(),
  })
  .passthrough();
export type PresetSource = z.infer<typeof presetSourceSchema>;
export const presetInputKeySchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9_]*$/, 'Input key must match /^[a-z][a-zA-Z0-9_]*$/');
// Stored preset records preserve unknown fields so newer versions never lose data on
// round-trips; new optional fields must use .default()/.optional() so old files still parse.
export const presetInputSchema = z
  .object({
    id: z.string().min(1),
    key: presetInputKeySchema,
    dataType: z.enum(['messages', 'text']),
  })
  .passthrough();

// Display names for preset inputs are derived from the key, never stored:
// `chat_history` reads as "Chat history".
export function presetInputLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
  if (words.length === 0) return key;
  return words.join(' ').replace(/^\S/, (first) => first.toUpperCase());
}

const depthPlacementSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ordered') }).passthrough(),
  z
    .object({ mode: z.literal('depth'), entryId: z.string().min(1), depth: z.number().int().nonnegative() })
    .passthrough(),
]);

// `displayName` is the editor label. A message entry's optional `name` is a template rendered like
// `content` and sent as the prompt message's name; slots have none (their messages carry their own).
export const presetEntrySchema = z.discriminatedUnion('kind', [
  z
    .object({
      id: z.string().min(1),
      displayName: z.string().trim().min(1),
      name: z.string().optional(),
      enabled: z.boolean(),
      kind: z.literal('message'),
      role: presetRoleSchema,
      content: z.string(),
      placement: depthPlacementSchema.default({ mode: 'ordered' }),
    })
    .passthrough(),
  z
    .object({
      id: z.string().min(1),
      displayName: z.string().trim().min(1),
      enabled: z.boolean(),
      kind: z.literal('slot'),
      inputKey: presetInputKeySchema,
      role: presetRoleSchema.default('user'),
    })
    .passthrough(),
]);

/**
 * Upgrades raw stored preset data written before entries had a `displayName`: an entry with `name` and no
 * `displayName` used `name` as its label, so it becomes `displayName` and the entry has no message name.
 * Apply to raw data before schema validation wherever stored presets are read. Returns a copy.
 */
export function upgradeLegacyPreset(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.entries)) return raw;
  const entries = raw.entries.map((entry: unknown) => {
    if (!isRecord(entry) || entry.name === undefined || entry.displayName !== undefined) return entry;
    const { name, ...rest } = entry;
    return { ...rest, displayName: name };
  });
  return { ...raw, entries };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type MessageEntry = Extract<z.infer<typeof presetEntrySchema>, { kind: 'message' }>;

/** The templated fields of a message entry, keyed by field name (the last segment of issue paths). */
export function entryTemplates(entry: MessageEntry): { field: 'content' | 'name'; template: string }[] {
  return [
    { field: 'content', template: entry.content },
    ...(entry.name === undefined ? [] : [{ field: 'name' as const, template: entry.name }]),
  ];
}

export const presetFieldsSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().optional(),
    inputs: z.array(presetInputSchema),
    entries: z.array(presetEntrySchema),
  })
  .passthrough()
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
        for (const { field, template } of entryTemplates(entry)) {
          for (const reference of analyzeTemplate(template).references) {
            const key = macroInputKey(reference.name);
            if (key !== undefined && !inputByKey.has(key))
              ctx.addIssue({ code: 'custom', path: ['entries', index, field], message: `Unknown input: ${key}` });
          }
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

// `source` is server-owned: it is set by imports and never accepted from client writes.
export const presetSchema = presetFieldsSchema
  .safeExtend({
    id: z.string().uuid(),
    createdAt: z.string(),
    updatedAt: z.string(),
    source: presetSourceSchema.optional(),
  })
  .passthrough();

export type Preset = z.infer<typeof presetSchema>;
export type PresetInput = z.infer<typeof presetInputSchema>;
export type PresetEntry = z.infer<typeof presetEntrySchema>;
// The prompt message is the canonical conversation message (tool role and tool fields are additive).
export const promptMessageSchema = conversationMessageSchema;
export const presetWarningSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
export type PromptMessage = z.infer<typeof promptMessageSchema>;
export type PresetWarning = z.infer<typeof presetWarningSchema>;

/** Whether any template of a message entry (content or name) references `{{input.<key>}}`. */
export function entryUsesInput(entry: MessageEntry, key: string): boolean {
  return entryTemplates(entry).some(({ template }) =>
    templateMacros(template).some((macro) => macroInputKey(macro.name) === key),
  );
}

export function presetWarnings(preset: Preset): PresetWarning[] {
  const warnings: PresetWarning[] = [];
  preset.inputs.forEach((input, index) => {
    const usedBySlot = preset.entries.some(
      (entry) => entry.kind === 'slot' && entry.enabled && entry.inputKey === input.key,
    );
    const usedByTemplate = preset.entries.some(
      (entry) => entry.kind === 'message' && entry.enabled && entryUsesInput(entry, input.key),
    );
    if (!usedBySlot && !usedByTemplate)
      warnings.push({ path: ['inputs', index], message: `Input "${input.key}" is not used by an enabled entry.` });
  });
  preset.entries.forEach((entry, index) => {
    if (entry.kind !== 'message' || !entry.enabled) return;
    for (const { field, template } of entryTemplates(entry)) {
      const { references, problems } = analyzeTemplate(template);
      for (const problem of problems) warnings.push({ path: ['entries', index, field], message: problem });
      for (const reference of references) {
        if (reference.root && !findMacro(reference.name))
          warnings.push({ path: ['entries', index, field], message: `Unknown macro: ${reference.expression}` });
      }
    }
  });
  return warnings;
}
