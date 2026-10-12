const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/;
const MAX_STEM_LENGTH = 80;
const FALLBACK_STEM = 'preset';

/** Readable, Windows-safe file stem for a preset name (letters and digits of any script, hyphen separated). */
export function presetFileStem(name: string): string {
  const slug = name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{Nd}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const stem = Array.from(slug).slice(0, MAX_STEM_LENGTH).join('').replace(/-+$/, '');
  if (!stem) return FALLBACK_STEM;
  return RESERVED_NAMES.test(stem) ? `${stem}-${FALLBACK_STEM}` : stem;
}

/** First free `<stem>.yaml`, `<stem>-2.yaml`, ... given the lowercase stems already in use. */
export function allocatePresetFile(stem: string, takenStems: ReadonlySet<string>): string {
  let candidate = stem;
  for (let n = 2; takenStems.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}`;
  return `${candidate}.yaml`;
}

/** Preset files are `.yaml`/`.yml`; dotfiles and `~` names are editor lock/backup files, never presets. */
export const isPresetFile = (fileName: string) => /\.ya?ml$/i.test(fileName) && !/^[.~]/.test(fileName);
export const fileStem = (fileName: string) => fileName.replace(/\.ya?ml$/i, '').toLowerCase();
