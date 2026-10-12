import { z } from 'zod';
import { importAppSchema, importSourceSchema, importSyncResultSchema } from '../imports.js';
import { endpoint } from './common.js';

export const importAppParamsSchema = z.object({ app: importAppSchema });
export const importSourceFieldsSchema = z.object({ path: z.string().trim().min(1) });

export const importEndpoints = {
  listImportSources: endpoint(z.array(importSourceSchema)),
  setImportSource: endpoint(importSourceSchema, importSourceFieldsSchema, importAppParamsSchema),
  syncImportSource: endpoint(importSyncResultSchema, undefined, importAppParamsSchema),
};
