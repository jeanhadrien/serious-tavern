import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { apiContract, presetSchema } from '@st/shared';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound, requireEntity } from '../errors.js';
import { previewPreset } from '../services/preset-preview.js';
import { pruneWorkflowsUsingPreset, withoutSource } from '../services/presets.js';
import type { ApiRoute } from './types.js';

export function registerPresets(app: FastifyInstance, context: AppContext) {
  const { presets, workflows } = context;
  app.get<ApiRoute<'listPresets'>>('/api/presets', async () => presets.list());
  app.post<ApiRoute<'previewPreset'>>('/api/presets/preview', async (request) =>
    previewPreset(context, apiContract.previewPreset.body.parse(request.body)),
  );
  app.post<ApiRoute<'createPreset'>>('/api/presets', async (request, reply) => {
    const date = now();
    const body = withoutSource(apiContract.createPreset.body.parse({ ...(request.body as object) }));
    const preset = presetSchema.parse({ ...body, id: randomUUID(), createdAt: date, updatedAt: date });
    await presets.save(preset);
    return reply.code(201).send(preset);
  });
  app.get<ApiRoute<'getPreset'>>('/api/presets/:id', async (request) =>
    requireEntity(presets, apiContract.getPreset.params.parse(request.params).id, 'Preset'),
  );
  app.put<ApiRoute<'updatePreset'>>('/api/presets/:id', async (request) => {
    const { id } = apiContract.updatePreset.params.parse(request.params);
    const body = withoutSource(apiContract.updatePreset.body.parse({ ...(request.body as object) }));
    // Spread old first so unknown fields from newer versions survive (migrate-on-write).
    // Imported presets are read-only; `source` is kept from the stored record.
    const preset = await presets.update(id, (old) => {
      if (old.source)
        throw new HttpError(
          409,
          'PRESET_READ_ONLY',
          'Imported presets are read-only. Duplicate the preset to edit it.',
        );
      return presetSchema.parse({ ...old, ...body, id, createdAt: old.createdAt, updatedAt: now() });
    });
    if (!preset) throw notFound('Preset');
    // Drop connections into preset inputs that no longer exist on dependent LLM nodes.
    await pruneWorkflowsUsingPreset(context, id);
    return preset;
  });
  app.delete<ApiRoute<'deletePreset'>>('/api/presets/:id', async (request, reply) => {
    const { id } = apiContract.deletePreset.params.parse(request.params);
    await requireEntity(presets, id, 'Preset');
    const users = (await workflows.list())
      .filter((workflow) => workflow.nodes.some((node) => node.type === 'llm' && node.config.presetId === id))
      .map((workflow) => workflow.name);
    if (users.length) throw new HttpError(409, 'PRESET_IN_USE', 'Preset is used by workflows', users);
    await presets.delete(id);
    return reply.code(204).send();
  });
}
