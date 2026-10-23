import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Over stdio, stdout carries the protocol: a stray line there breaks the client's connection.
it('writes nothing to stdout from the sources', () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const sources = readdirSync(directory).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  expect(sources.length).toBeGreaterThan(3);
  for (const name of sources)
    expect(readFileSync(directory + name, 'utf8'), name).not.toMatch(/console\.(log|info|debug)|process\.stdout/);
});
