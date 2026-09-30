import type { NodeConfigPanelProps } from './types.js';

export function CharacterPanel({ config, onChange, context }: NodeConfigPanelProps) {
  const characters = context?.characters ?? [];
  const selected = config.source === 'card' ? String(config.characterId ?? '') : 'session';
  return (
    <label>
      Character
      <select
        value={selected}
        onChange={(event) =>
          onChange({
            ...config,
            source: event.target.value === 'session' ? 'session' : 'card',
            characterId: event.target.value === 'session' ? '' : event.target.value,
          })
        }
      >
        <option value="session">Session character</option>
        {config.source === 'card' && !characters.some((card) => card.id === selected) && (
          <option value={selected}>Missing character card</option>
        )}
        {characters.map((card) => (
          <option key={card.id} value={card.id}>
            {card.name}
          </option>
        ))}
      </select>
    </label>
  );
}
