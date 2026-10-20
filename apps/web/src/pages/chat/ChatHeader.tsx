import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { ApiBody, Character, Persona, Session } from '@st/shared';
import { charactersApi, personasApi } from '../../api.js';
import { IconButton } from '../../components/IconButton.js';

interface ContextSelectorProps {
  label: string;
  value?: string;
  items: (Character | Persona)[];
  avatarUrl: (id: string) => string;
  disabled: boolean;
  onChange: (id: string | null) => void;
}

function ContextSelector({ label, value, items, avatarUrl, disabled, onChange }: ContextSelectorProps) {
  const selected = items.find((item) => item.id === value);
  return (
    <label className="context-selector">
      {label}
      {selected && typeof selected.avatar === 'string' && <img src={avatarUrl(selected.id)} alt="" />}
      <select
        aria-label={`Active ${label.toLowerCase()}`}
        disabled={disabled}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">None</option>
        {items.map((item) => (
          <option value={item.id} key={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}

interface ChatHeaderProps {
  title: string;
  characterId?: Session['characterId'];
  personaId?: Session['personaId'];
  characters: Character[];
  personas: Persona[];
  disabled: boolean;
  onUpdate: (changes: ApiBody<'updateSession'>) => Promise<void>;
  /** The chat panel (settings, story state); usable while a turn runs, unlike the rest of the header. */
  panelOpen: boolean;
  onTogglePanel: () => void;
}

export function ChatHeader({
  title,
  characterId,
  personaId,
  characters,
  personas,
  disabled,
  onUpdate,
  panelOpen,
  onTogglePanel,
}: ChatHeaderProps) {
  const [draft, setDraft] = useState(title);
  useEffect(() => {
    setDraft(title);
  }, [title]);
  return (
    <>
      <header className="chat-header">
        <input
          aria-label="Chat title"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim() !== title) void onUpdate({ title: draft.trim() || 'New chat' });
          }}
        />
        <IconButton
          icon={SlidersHorizontal}
          label="Chat panel"
          className="chat-panel-toggle"
          aria-pressed={panelOpen}
          onClick={onTogglePanel}
        />
      </header>
      <div className="session-context-selectors">
        <ContextSelector
          label="Character"
          value={characterId}
          items={characters}
          avatarUrl={charactersApi.avatarUrl}
          disabled={disabled}
          onChange={(id) => void onUpdate({ characterId: id })}
        />
        <ContextSelector
          label="Persona"
          value={personaId}
          items={personas}
          avatarUrl={personasApi.avatarUrl}
          disabled={disabled}
          onChange={(id) => void onUpdate({ personaId: id })}
        />
      </div>
    </>
  );
}
