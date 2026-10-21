import { z } from 'zod';
import { importAppSchema, importSourceSchema, importSyncResultSchema } from '../imports.js';
import { endpoint } from './common.js';

export const importAppParamsSchema = z.object({ app: importAppSchema });
export const importSourceFieldsSchema = z.object({ path: z.string().trim().min(1) });

export const importEndpoints = {
  listImportSources: endpoint({ method: 'GET', path: '/api/import-sources' }, z.array(importSourceSchema)),
  setImportSource: endpoint(
    { method: 'PUT', path: '/api/import-sources/:app' },
    importSourceSchema,
    importSourceFieldsSchema,
    importAppParamsSchema,
  ),
  syncImportSource: endpoint(
    { method: 'POST', path: '/api/import-sources/:app/sync' },
    importSyncResultSchema,
    undefined,
    importAppParamsSchema,
  ),
};
