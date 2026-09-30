import { useEffect, useState } from 'react';
import type { ApiBody, Character, Persona, Session, Workflow } from '@st/shared';
import { charactersApi, personasApi } from '../../api.js';

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
  workflowId: string;
  characterId?: Session['characterId'];
  personaId?: Session['personaId'];
  workflows: Workflow[];
  characters: Character[];
  personas: Persona[];
  disabled: boolean;
  onUpdate: (changes: ApiBody<'updateSession'>) => Promise<void>;
}

export function ChatHeader({
  title,
  workflowId,
  characterId,
  personaId,
  workflows,
  characters,
  personas,
  disabled,
  onUpdate,
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
        <select
          aria-label="Workflow"
          value={workflowId}
          disabled={disabled}
          onChange={(event) => void onUpdate({ workflowId: event.target.value })}
        >
          {workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))}
        </select>
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
