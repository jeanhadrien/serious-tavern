import { useEffect, useState } from 'react';
import type { ImportSource } from '@st/shared';
import { formatLastSync, importConnectors, type ImportConnector } from './importConnectors.js';
import { useImportSources } from './useImportSources.js';
import './settings.css';

function ConnectorRow(props: {
  connector: ImportConnector;
  source?: ImportSource;
  syncing: boolean;
  busy: boolean;
  onSave(path: string): void;
  onSync(): void;
}) {
  const savedPath = props.source?.path ?? '';
  const [draft, setDraft] = useState(savedPath);
  // The server stores the resolved absolute path, so the field follows the saved value after each save.
  useEffect(() => setDraft(savedPath), [savedPath]);
  const trimmed = draft.trim();

  return (
    <div className="import-connector">
      <h3>{props.connector.label}</h3>
      <label>
        Install folder
        <input
          value={draft}
          placeholder={props.connector.folderHint}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <small className="hint">
        {savedPath ? formatLastSync(props.source?.lastSyncAt) : 'Save the install folder before syncing.'}
      </small>
      <div className="import-actions">
        <button disabled={!trimmed || trimmed === savedPath} onClick={() => props.onSave(trimmed)}>
          Save folder
        </button>
        <button className="primary" disabled={!savedPath || props.busy} onClick={props.onSync}>
          {props.syncing ? 'Syncing…' : 'Sync'}
        </button>
      </div>
    </div>
  );
}

export function ImportContent() {
  const { sources, syncing, save, sync } = useImportSources();
  return (
    <section className="import-content">
      <h2>Import content</h2>
      <p className="hint">
        Imports copy presets from another app's install into read-only local presets. Sync re-reads the whole install
        folder.
      </p>
      {importConnectors.map((connector) => (
        <ConnectorRow
          key={connector.app}
          connector={connector}
          source={sources.find((source) => source.app === connector.app)}
          syncing={syncing === connector.app}
          busy={syncing !== undefined}
          onSave={(path) => void save(connector, path)}
          onSync={() => void sync(connector)}
        />
      ))}
    </section>
  );
}
