import { useEffect, useRef, useState, type DragEvent } from 'react';
import { characterSchema, personaSchema, type Character, type Persona } from '@st/shared';
import { api, getCharacters, getPersonas, json } from '../api.js';
import { alerts } from '../alerts/index.js';

type ImportResult<T> = { imported: T[]; failed: { filename: string; error: { code: string; message: string } }[] };
const avatarUrl = (type: 'characters' | 'personas', item: Character | Persona) =>
  typeof item.avatar === 'string' ? `/api/${type}/${item.id}/avatar` : '';
const imageFiles = (files: FileList | File[]) => Array.from(files);

function DropOverlay({ visible, label }: { visible: boolean; label: string }) {
  return visible ? <div className="drop-overlay" aria-hidden="true"><strong>{label}</strong></div> : null;
}

export function Characters() {
  const [list, setList] = useState<Character[]>([]);
  const [draft, setDraft] = useState<Character>();
  const [saved, setSaved] = useState('');
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const refresh = async () => setList((await getCharacters()).sort((a, b) => a.name.localeCompare(b.name)));
  const choose = (character: Character) => { setDraft(structuredClone(character)); setSaved(JSON.stringify(character)); };
  useEffect(() => { void refresh().then(() => {}).catch(() => {}); }, []);
  const create = async () => {
    try {
      const character = await api<Character>('/characters', json('POST', { name: 'New character' }));
      await refresh(); choose(character); alerts.success('Character created');
    } catch { /* API errors are toasted. */ }
  };
  const save = async () => {
    if (!draft) return;
    const parsed = characterSchema.safeParse(draft);
    if (!parsed.success) {
      alerts.error('Fix the character validation errors before saving', { details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n') });
      return;
    }
    try {
      const character = await api<Character>(`/characters/${draft.id}`, json('PUT', draft));
      choose(character); await refresh(); alerts.success('Character saved');
    } catch { /* API errors are toasted. */ }
  };
  const remove = async () => {
    if (!draft || !window.confirm(`Delete ${draft.name}?`)) return;
    try {
      await api(`/characters/${draft.id}`, json('DELETE'));
      setDraft(undefined); setSaved(''); await refresh(); alerts.info('Character deleted');
    } catch { /* API errors are toasted. */ }
  };
  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    const form = new FormData();
    files.forEach(file => form.append('files', file, file.name));
    try {
      const result = await api<ImportResult<Character>>('/characters/import', { method: 'POST', body: form });
      if (result.imported.length) {
        await refresh(); choose(result.imported.at(-1)!);
        alerts.success(`Imported ${result.imported.length} character${result.imported.length === 1 ? '' : 's'}`);
      }
      if (result.failed.length) alerts.error(`${result.failed.length} character file${result.failed.length === 1 ? '' : 's'} could not be imported`,
        { details: result.failed.map(item => `${item.filename}: ${item.error.message}`).join('\n') });
    } catch { /* API errors are toasted. */ }
  };
  const uploadAvatar = async (file?: File) => {
    if (!draft || !file) return;
    const form = new FormData(); form.append('file', file, file.name);
    try {
      const character = await api<Character>(`/characters/${draft.id}/avatar`, { method: 'PUT', body: form });
      choose(character); await refresh(); alerts.success('Avatar updated');
    } catch { /* API errors are toasted. */ }
  };
  const drop = (event: DragEvent) => {
    event.preventDefault(); setDragging(false);
    void importFiles(imageFiles(event.dataTransfer.files).filter(file =>
      file.type === 'image/png' || /\.png$/i.test(file.name) || /\.json$/i.test(file.name)));
  };
  const change = (field: keyof Character, value: unknown) => draft && setDraft({ ...draft, [field]: value });
  const filtered = list.filter(item => item.name.toLowerCase().includes(search.toLowerCase()));
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  return <div className="entity-page" onDragOver={event => { event.preventDefault(); setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={drop}>
    <DropOverlay visible={dragging} label="Drop character card PNG or JSON files to import" />
    <aside className="entity-list">
      <div className="toolbar"><h2>Characters</h2><button className="primary" onClick={() => void create()}>+ New</button></div>
      <input aria-label="Search characters" placeholder="Search characters…" value={search} onChange={event => setSearch(event.target.value)} />
      <button className="entity-import" onClick={() => importInput.current?.click()}>Import cards</button>
      <input ref={importInput} hidden type="file" multiple accept=".json,.png,application/json,image/png"
        onChange={event => { void importFiles(imageFiles(event.target.files ?? [])); event.target.value = ''; }} />
      {filtered.map(character => <button className={`entity-row ${draft?.id === character.id ? 'selected' : ''}`}
        key={character.id} onClick={() => choose(character)}>
        {avatarUrl('characters', character) ? <img src={`${avatarUrl('characters', character)}?v=${character.updatedAt}`} /> :
          <span className="avatar-fallback">{character.name.slice(0, 1).toUpperCase()}</span>}
        <span>{character.name}{dirty && draft?.id === character.id && <i className="dirty-dot"> •</i>}</span>
      </button>)}
    </aside>
    {draft ? <section className="entity-editor">
      <div className="entity-toolbar"><div><h1>{draft.name || 'Character'}</h1>{dirty && <span className="dirty-dot">Unsaved</span>}</div>
        <div className="toolbar"><button onClick={() => window.open(`/api/characters/${draft.id}/export?format=json`, '_blank')}>Export JSON</button>
          <button onClick={() => window.open(`/api/characters/${draft.id}/export?format=png`, '_blank')}>Export PNG card</button>
          <button onClick={() => void remove()}>Delete</button>
          <button className="primary" onClick={() => void save()} disabled={!dirty}>Save</button></div></div>
      <div className="character-form">
        <div className="entity-avatar">
          {avatarUrl('characters', draft) ? <img src={`${avatarUrl('characters', draft)}?v=${draft.updatedAt}`} /> :
            <span className="avatar-fallback large">{draft.name.slice(0, 1).toUpperCase()}</span>}
          <button onClick={() => avatarInput.current?.click()}>Change avatar</button>
          <input ref={avatarInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={event => { void uploadAvatar(event.target.files?.[0]); event.target.value = ''; }} />
        </div>
        <div className="character-primary-fields">
          <label>Name<input value={draft.name} onChange={event => change('name', event.target.value)} /></label>
          <label>Description<textarea rows={6} value={draft.description} onChange={event => change('description', event.target.value)} /></label>
          <label>Personality<textarea rows={5} value={draft.personality} onChange={event => change('personality', event.target.value)} /></label>
        </div>
        <details className="character-advanced"><summary>Advanced character fields</summary><div className="entity-field-grid">
          <label>Scenario<textarea rows={4} value={draft.scenario} onChange={event => change('scenario', event.target.value)} /></label>
          <label>First message<textarea rows={5} value={draft.first_mes} onChange={event => change('first_mes', event.target.value)} /></label>
          <label>Example dialogue<textarea rows={5} value={draft.mes_example} onChange={event => change('mes_example', event.target.value)} /></label>
          <label>System prompt<textarea rows={4} value={draft.system_prompt} onChange={event => change('system_prompt', event.target.value)} /></label>
          <label>Post-history instructions<textarea rows={4} value={draft.post_history_instructions} onChange={event => change('post_history_instructions', event.target.value)} /></label>
          <label>Creator notes<textarea rows={3} value={draft.creator_notes} onChange={event => change('creator_notes', event.target.value)} /></label>
          <label>Alternate greetings<textarea rows={4} value={draft.alternate_greetings.join('\n')}
            onChange={event => change('alternate_greetings', event.target.value.split('\n'))} /></label>
          <label>Tags<input value={draft.tags.join(', ')} onChange={event => change('tags', event.target.value.split(',').map(v => v.trim()).filter(Boolean))} /></label>
          <label>Creator<input value={draft.creator} onChange={event => change('creator', event.target.value)} /></label>
          <label>Character version<input value={draft.character_version} onChange={event => change('character_version', event.target.value)} /></label>
          <label>Extensions (JSON)<textarea rows={6} value={JSON.stringify(draft.extensions, null, 2)}
            onChange={event => { try { change('extensions', JSON.parse(event.target.value)); } catch { /* Keep editing until valid JSON. */ } }} /></label>
        </div></details>
      </div>
    </section> : <div className="empty-state"><h1>Characters</h1><p>Select a character or import a character card.</p></div>}
  </div>;
}

export function Personas() {
  const [list, setList] = useState<Persona[]>([]);
  const [draft, setDraft] = useState<Persona>();
  const [saved, setSaved] = useState('');
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const refresh = async () => setList((await getPersonas()).sort((a, b) => a.name.localeCompare(b.name)));
  const choose = (persona: Persona) => { setDraft(structuredClone(persona)); setSaved(JSON.stringify(persona)); };
  useEffect(() => { void refresh().catch(() => {}); }, []);
  const create = async () => {
    try {
      const persona = await api<Persona>('/personas', json('POST', { name: 'New persona' }));
      await refresh(); choose(persona); alerts.success('Persona created');
    } catch { /* API errors are toasted. */ }
  };
  const save = async () => {
    if (!draft) return;
    const parsed = personaSchema.safeParse(draft);
    if (!parsed.success) { alerts.error('Enter a valid persona name'); return; }
    try {
      const persona = await api<Persona>(`/personas/${draft.id}`, json('PUT', draft));
      choose(persona); await refresh(); alerts.success('Persona saved');
    } catch { /* API errors are toasted. */ }
  };
  const remove = async () => {
    if (!draft || !window.confirm(`Delete ${draft.name}?`)) return;
    try {
      await api(`/personas/${draft.id}`, json('DELETE'));
      setDraft(undefined); setSaved(''); await refresh(); alerts.info('Persona deleted');
    } catch { /* API errors are toasted. */ }
  };
  const importFiles = async (files: File[]) => {
    const images = files.filter(file => file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name));
    if (!images.length) { alerts.error('Choose image files to create personas'); return; }
    const form = new FormData(); images.forEach(file => form.append('files', file, file.name));
    try {
      const result = await api<ImportResult<Persona>>('/personas/import', { method: 'POST', body: form });
      if (result.imported.length) {
        await refresh(); choose(result.imported.at(-1)!);
        alerts.success(`Created ${result.imported.length} persona${result.imported.length === 1 ? '' : 's'} from images`);
      }
      if (result.failed.length) alerts.error('Some persona images could not be imported',
        { details: result.failed.map(item => `${item.filename}: ${item.error.message}`).join('\n') });
    } catch { /* API errors are toasted. */ }
  };
  const uploadAvatar = async (file?: File) => {
    if (!draft || !file) return;
    const form = new FormData(); form.append('file', file, file.name);
    try {
      const persona = await api<Persona>(`/personas/${draft.id}/avatar`, { method: 'PUT', body: form });
      choose(persona); await refresh(); alerts.success('Avatar updated');
    } catch { /* API errors are toasted. */ }
  };
  const drop = (event: DragEvent) => { event.preventDefault(); setDragging(false); void importFiles(imageFiles(event.dataTransfer.files)); };
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const filtered = list.filter(item => item.name.toLowerCase().includes(search.toLowerCase()));
  return <div className="entity-page" onDragOver={event => { event.preventDefault(); setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={drop}>
    <DropOverlay visible={dragging} label="Drop an image to create a persona" />
    <aside className="entity-list">
      <div className="toolbar"><h2>Personas</h2><button className="primary" onClick={() => void create()}>+ New</button></div>
      <input aria-label="Search personas" placeholder="Search personas…" value={search} onChange={event => setSearch(event.target.value)} />
      <button className="entity-import" onClick={() => importInput.current?.click()}>Create from image</button>
      <input ref={importInput} hidden type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={event => { void importFiles(imageFiles(event.target.files ?? [])); event.target.value = ''; }} />
      {filtered.map(persona => <button className={`entity-row ${draft?.id === persona.id ? 'selected' : ''}`}
        key={persona.id} onClick={() => choose(persona)}>
        {avatarUrl('personas', persona) ? <img src={`${avatarUrl('personas', persona)}?v=${persona.updatedAt}`} /> :
          <span className="avatar-fallback">{persona.name.slice(0, 1).toUpperCase()}</span>}
        <span>{persona.name}{dirty && draft?.id === persona.id && <i className="dirty-dot"> •</i>}</span>
      </button>)}
    </aside>
    {draft ? <section className="entity-editor">
      <div className="entity-toolbar"><div><h1>{draft.name}</h1>{dirty && <span className="dirty-dot">Unsaved</span>}</div>
        <div className="toolbar"><button onClick={() => void remove()}>Delete</button>
          <button className="primary" onClick={() => void save()} disabled={!dirty}>Save</button></div></div>
      <div className="persona-form">
        <div className="entity-avatar">
          {avatarUrl('personas', draft) ? <img src={`${avatarUrl('personas', draft)}?v=${draft.updatedAt}`} /> :
            <span className="avatar-fallback large">{draft.name.slice(0, 1).toUpperCase()}</span>}
          <button onClick={() => avatarInput.current?.click()}>Change avatar</button>
          <input ref={avatarInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={event => { void uploadAvatar(event.target.files?.[0]); event.target.value = ''; }} />
        </div>
        <div className="character-primary-fields">
          <label>Name<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Description<textarea rows={8} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
        </div>
      </div>
    </section> : <div className="empty-state"><h1>Personas</h1><p>Select or create a persona, or drop an image to get started.</p></div>}
  </div>;
}
