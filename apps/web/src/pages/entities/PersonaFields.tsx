import type { Persona } from '@st/shared';

export function PersonaFields({
  draft,
  change,
}: {
  draft: Persona;
  change: (field: keyof Persona, value: unknown) => void;
}) {
  return (
    <div className="character-primary-fields">
      <label>
        Name
        <input value={draft.name} onChange={(event) => change('name', event.target.value)} />
      </label>
      <label>
        Description
        <textarea rows={8} value={draft.description} onChange={(event) => change('description', event.target.value)} />
      </label>
    </div>
  );
}
