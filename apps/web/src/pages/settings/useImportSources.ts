import { useEffect, useState } from 'react';
import type { ImportApp, ImportSource } from '@st/shared';
import { importsApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import { formatSyncResult, type ImportConnector } from './importConnectors.js';

// Loads connector configs and runs save/sync. API failures are toasted by the transport.
export function useImportSources() {
  const [sources, setSources] = useState<ImportSource[]>([]);
  const [syncing, setSyncing] = useState<ImportApp>();
  const refresh = () => importsApi.list().then(setSources);

  useEffect(() => {
    void refresh().catch(() => {});
  }, []);

  const save = async (connector: ImportConnector, path: string) => {
    try {
      await importsApi.set(connector.app, { path });
      alerts.success(`${connector.label} folder saved`);
      await refresh();
    } catch {
      /* API errors are toasted. */
    }
  };

  const sync = async (connector: ImportConnector) => {
    setSyncing(connector.app);
    try {
      const result = await importsApi.sync(connector.app);
      alerts.success(formatSyncResult(connector.label, result));
      await refresh();
    } catch {
      /* API errors are toasted. */
    } finally {
      setSyncing(undefined);
    }
  };

  return { sources, syncing, save, sync };
}
