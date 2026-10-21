import { z } from 'zod';
import { appSettingsSchema } from '../app-settings.js';
import { endpoint } from './common.js';

// A partial update: the given fields are merged into the stored file, which keeps every other key it holds.
export const updateAppSettingsSchema = z.object({
  forkKeepsAlternatives: z.boolean().optional(),
  showMessageStats: z.boolean().optional(),
});
export type AppSettingsPatch = z.infer<typeof updateAppSettingsSchema>;

export const appSettingsEndpoints = {
  // The app-wide preferences with their defaults filled in (see app-settings.ts).
  getAppSettings: endpoint(appSettingsSchema),
  // The whole settings after the merge. `500 APP_SETTINGS_UNREADABLE` when the stored file cannot be read (it is never overwritten).
  updateAppSettings: endpoint(appSettingsSchema, updateAppSettingsSchema),
};
