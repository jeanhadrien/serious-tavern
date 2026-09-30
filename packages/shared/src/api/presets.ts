import { z } from 'zod';
import { presetSchema, presetFieldsSchema, promptMessageSchema, presetWarningSchema } from '../preset.js';
import { endpoint, idParamsSchema, noContentSchema } from './common.js';

export const presetEndpoints = {
  listPresets: endpoint(z.array(presetSchema)),
  createPreset: endpoint(presetSchema, presetFieldsSchema),
  getPreset: endpoint(presetSchema, undefined, idParamsSchema),
  updatePreset: endpoint(presetSchema, presetFieldsSchema, idParamsSchema),
  deletePreset: endpoint(noContentSchema, undefined, idParamsSchema),
  previewPreset: endpoint(
    z.object({ messages: z.array(promptMessageSchema), warnings: z.array(presetWarningSchema) }),
    z.object({
      preset: presetSchema,
      inputs: z.record(z.string(), z.union([z.string(), z.array(promptMessageSchema)])).optional(),
      sessionId: z.string().uuid().optional(),
    }),
  ),
};
