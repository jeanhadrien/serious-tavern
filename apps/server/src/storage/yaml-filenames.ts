const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/;
const MAX_STEM_LENGTH = 80;

/**
 * Readable, Windows-safe file stem for a record name (letters and digits of any script, hyphen separated).
 * `fallback` names records whose name has no letters or digits at all.
 */
export function yamlFileStem(name: string, fallback: string): string {
  const slug = name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{Nd}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const stem = Array.from(slug).slice(0, MAX_STEM_LENGTH).join('').replace(/-+$/, '');
  if (!stem) return fallback;
  return RESERVED_NAMES.test(stem) ? `${stem}-${fallback}` : stem;
}

/** First free `<stem>.yaml`, `<stem>-2.yaml`, ... given the lowercase stems already in use. */
export function allocateYamlFile(stem: string, takenStems: ReadonlySet<string>): string {
  let candidate = stem;
  for (let n = 2; takenStems.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}`;
  return `${candidate}.yaml`;
}

/** Record files are `.yaml`/`.yml`; dotfiles and `~` names are editor lock/backup files, never records. */
export const isYamlFile = (fileName: string) => /\.ya?ml$/i.test(fileName) && !/^[.~]/.test(fileName);
export const fileStem = (fileName: string) => fileName.replace(/\.ya?ml$/i, '').toLowerCase();
