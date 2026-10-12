import { useEffect, useState } from 'react';
import type { SecretSummary } from '@st/shared';
import { secretsApi } from '../api.js';
import { alerts } from '../alerts/index.js';
import { ImportContent } from './settings/ImportContent.js';
export function Settings() {
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [name, setName] = useState('openrouter');
  const [value, setValue] = useState('');
  const refresh = () => secretsApi.list().then(setSecrets);
  useEffect(() => {
    void refresh().catch(() => {});
  }, []);
  const save = async () => {
    try {
      await secretsApi.set(name, { value });
      setValue('');
      alerts.success('Secret saved');
      await refresh();
    } catch {
      /* API errors are toasted. */
    }
  };
  const remove = async (secret: string) => {
    try {
      await secretsApi.delete(secret);
      await refresh();
    } catch {
      /* API errors are toasted. */
    }
  };
  return (
    <div className="page narrow">
      <h1>Settings</h1>
      <p className="hint">API keys are encrypted on the server and cannot be retrieved through the API.</p>
      <h2>Secrets</h2>
      {secrets.length === 0 && <p className="hint">No secrets saved.</p>}
      {secrets.map((s) => (
        <div className="list-row" key={s.name}>
          <span>
            {s.name} <small>{s.hint}</small>
          </span>
          <button onClick={() => void remove(s.name)}>Delete</button>
        </div>
      ))}
      <h2>Add or replace a secret</h2>
      <div className="stack">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Value
          <input type="password" autoComplete="new-password" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button className="primary" disabled={!name || !value} onClick={() => void save()}>
          Save secret
        </button>
      </div>
      <ImportContent />
    </div>
  );
}
