import type { PresetSource } from '@st/shared';
import { importedNotice } from './presetImport.js';

export function ImportedBanner(props: { source: PresetSource; onDuplicate(): void }) {
  return (
    <div className={`preset-banner${props.source.missing ? ' missing' : ''}`} role="note">
      <p>{importedNotice(props.source)}</p>
      <button onClick={props.onDuplicate}>Duplicate to edit</button>
    </div>
  );
}
