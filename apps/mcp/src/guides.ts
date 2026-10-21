import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The user guides (`docs/*.md`), found from this file so it works whatever directory the client launches us from. */
const DEFAULT_DOCS_DIR = fileURLToPath(new URL('../../../docs/', import.meta.url));

export type Guide = { topic: string; title: string; file: string };

/** The guide topics: one per Markdown file directly in the docs directory (`WORKFLOWS.md` is `workflows`). */
export async function listGuides(docsDir = DEFAULT_DOCS_DIR): Promise<Guide[]> {
  const files = (await readdir(docsDir)).filter((name) => name.endsWith('.md')).sort();
  return Promise.all(
    files.map(async (name) => {
      const heading = (await readFile(join(docsDir, name), 'utf8')).match(/^# (.+)$/m)?.[1] ?? name;
      return {
        topic: name.slice(0, -'.md'.length).toLowerCase(),
        title: heading.replace(/\s+[—-]\s+user guide$/i, ''),
        file: join(docsDir, name),
      };
    }),
  );
}

export const guideText = (guide: Guide) => readFile(guide.file, 'utf8');
