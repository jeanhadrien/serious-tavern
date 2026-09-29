import { useEffect, useState } from 'react';
import { api, json, type SecretSummary } from '../api.js';
export function Settings() {
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [name, setName] = useState('openrouter');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const refresh = () => api<SecretSummary[]>('/secrets').then(setSecrets).catch(e => setError(String(e)));
  useEffect(() => { void refresh(); }, []);
  const save = async () => {
    try { await api(`/secrets/${encodeURIComponent(name)}`, json('PUT', { value })); setValue(''); setError(''); await refresh(); }
    catch (e) { setError(String(e)); }
  };
  const remove = async (secret: string) => {
    try { await api(`/secrets/${encodeURIComponent(secret)}`, json('DELETE')); await refresh(); }
    catch (e) { setError(String(e)); }
  };
  return <div className="page narrow"><h1>Settings</h1><p className="hint">API keys are encrypted on the server and cannot be retrieved through the API.</p>
    {error && <p className="error">{error}</p>}
    <h2>Secrets</h2>{secrets.length === 0 && <p className="hint">No secrets saved.</p>}
    {secrets.map(s => <div className="list-row" key={s.name}><span>{s.name} <small>{s.hint}</small></span>
      <button onClick={() => void remove(s.name)}>Delete</button></div>)}
    <h2>Add or replace a secret</h2><div className="stack">
      <label>Name<input value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Value<input type="password" autoComplete="new-password" value={value} onChange={e => setValue(e.target.value)} /></label>
      <button className="primary" disabled={!name || !value} onClick={() => void save()}>Save secret</button>
    </div></div>;
}
