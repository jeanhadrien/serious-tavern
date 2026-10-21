import { z } from 'zod';
import { presetSchema, presetFieldsSchema, promptMessageSchema, presetWarningSchema } from '../preset.js';
import { endpoint, idParamsSchema, noContentSchema } from './common.js';

export const presetEndpoints = {
  listPresets: endpoint(
    {
      method: 'GET',
      path: '/api/presets',
      description:
        'List all prompt presets (full records). A preset is the template of messages an LLM node sends to the model.',
    },
    z.array(presetSchema),
  ),
  createPreset: endpoint(
    {
      method: 'POST',
      path: '/api/presets',
      description:
        'Create a preset. Entry and input ids are re-derived on save: continue from the returned record, not from what you sent.',
    },
    presetSchema,
    presetFieldsSchema,
  ),
  getPreset: endpoint(
    { method: 'GET', path: '/api/presets/:id', description: 'Get one preset, with its inputs and entries.' },
    presetSchema,
    undefined,
    idParamsSchema,
  ),
  updatePreset: endpoint(
    {
      method: 'PUT',
      path: '/api/presets/:id',
      description:
        'Replace a preset with the given one. Imported presets are read-only (409 PRESET_READ_ONLY). Ids are re-derived on save, so continue from the returned record.',
    },
    presetSchema,
    presetFieldsSchema,
    idParamsSchema,
  ),
  deletePreset: endpoint(
    {
      method: 'DELETE',
      path: '/api/presets/:id',
      description: 'Delete a preset. Refused with 409 PRESET_IN_USE while an LLM node uses it.',
    },
    noContentSchema,
    undefined,
    idParamsSchema,
  ),
  previewPreset: endpoint(
    {
      method: 'POST',
      path: '/api/presets/preview',
      description:
        'Render a preset into the messages it would send, with warnings. Takes a full preset record (id and timestamps included, any valid values), so a draft can be previewed unsaved. Inputs left out fall back to the chat history (with sessionId) or a sample.',
    },
    z.object({ messages: z.array(promptMessageSchema), warnings: z.array(presetWarningSchema) }),
    z.object({
      preset: presetSchema,
      inputs: z.record(z.string(), z.union([z.string(), z.array(promptMessageSchema)])).optional(),
      sessionId: z.string().uuid().optional(),
    }),
  ),
};
