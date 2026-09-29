import type { Character } from '@st/shared';

export function CharacterFields({
  draft,
  change,
}: {
  draft: Character;
  change: (field: keyof Character, value: unknown) => void;
}) {
  return (
    <>
      <div className="character-primary-fields">
        <label>
          Name
          <input value={draft.name} onChange={(event) => change('name', event.target.value)} />
        </label>
        <label>
          Description
          <textarea
            rows={6}
            value={draft.description}
            onChange={(event) => change('description', event.target.value)}
          />
        </label>
        <label>
          Personality
          <textarea
            rows={5}
            value={draft.personality}
            onChange={(event) => change('personality', event.target.value)}
          />
        </label>
      </div>
      <details className="character-advanced">
        <summary>Advanced character fields</summary>
        <div className="entity-field-grid">
          {(
            [
              ['scenario', 'Scenario', 4],
              ['first_mes', 'First message', 5],
              ['mes_example', 'Example dialogue', 5],
              ['system_prompt', 'System prompt', 4],
              ['post_history_instructions', 'Post-history instructions', 4],
              ['creator_notes', 'Creator notes', 3],
            ] as const
          ).map(([field, label, rows]) => (
            <label key={field}>
              {label}
              <textarea rows={rows} value={draft[field]} onChange={(event) => change(field, event.target.value)} />
            </label>
          ))}
          <label>
            Alternate greetings
            <textarea
              rows={4}
              value={draft.alternate_greetings.join('\n')}
              onChange={(event) => change('alternate_greetings', event.target.value.split('\n'))}
            />
          </label>
          <label>
            Tags
            <input
              value={draft.tags.join(', ')}
              onChange={(event) =>
                change(
                  'tags',
                  event.target.value
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>
          <label>
            Creator
            <input value={draft.creator} onChange={(event) => change('creator', event.target.value)} />
          </label>
          <label>
            Character version
            <input
              value={draft.character_version}
              onChange={(event) => change('character_version', event.target.value)}
            />
          </label>
          <label>
            Extensions (JSON)
            <textarea
              rows={6}
              value={JSON.stringify(draft.extensions, null, 2)}
              onChange={(event) => {
                try {
                  change('extensions', JSON.parse(event.target.value));
                } catch {
                  /* Keep editing until valid JSON. */
                }
              }}
            />
          </label>
        </div>
      </details>
    </>
  );
}
