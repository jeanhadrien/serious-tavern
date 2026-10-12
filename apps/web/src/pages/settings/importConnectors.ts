import type { ImportApp, ImportSyncResult } from '@st/shared';

export interface ImportConnector {
  app: ImportApp;
  label: string;
  folderHint: string;
}

// One entry per connector the server supports. Adding an app here shows it in Settings.
export const importConnectors: ImportConnector[] = [
  { app: 'sillytavern', label: 'SillyTavern', folderHint: '/path/to/SillyTavern' },
];

export function formatSyncResult(label: string, result: ImportSyncResult): string {
  return `${label} synced: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.missing} missing.`;
}

export function formatLastSync(lastSyncAt?: string): string {
  return lastSyncAt ? `Last synced ${new Date(lastSyncAt).toLocaleString()}.` : 'Never synced.';
}
