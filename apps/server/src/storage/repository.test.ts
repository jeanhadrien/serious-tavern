import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { JsonRepository } from './repository.js';

type Item = { id: string; value: string };

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'repository-test-'));
}

it('never deletes corrupt records and reports file context', async () => {
  const directory = await tempDir();
  try {
    const repository = new JsonRepository<Item>(directory);
    await repository.save({ id: 'good', value: 'kept' });
    await writeFile(join(directory, 'bad.json'), '{ not valid json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const items = await repository.list();
      expect(items).toEqual([{ id: 'good', value: 'kept' }]);
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain('bad.json');
      // The corrupt file is left on disk for manual repair.
      expect(await readFile(join(directory, 'bad.json'), 'utf8')).toBe('{ not valid json');
    } finally {
      warn.mockRestore();
    }
    await expect(repository.get('bad')).rejects.toThrow(/bad\.json/);
    expect(await readFile(join(directory, 'bad.json'), 'utf8')).toBe('{ not valid json');
    expect(await repository.get('missing')).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps the id invariant on update', async () => {
  const directory = await tempDir();
  try {
    const repository = new JsonRepository<Item>(directory);
    await repository.save({ id: 'one', value: 'a' });
    await expect(repository.update('one', () => ({ id: 'other', value: 'b' }))).rejects.toThrow(
      'Repository update cannot change an item id',
    );
    expect(await repository.get('one')).toEqual({ id: 'one', value: 'a' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
