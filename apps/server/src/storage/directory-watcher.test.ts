import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isYamlFile } from './yaml-filenames.js';
import { watchDirectory, type DirectoryWatcher } from './directory-watcher.js';

let directory: string;
let watcher: DirectoryWatcher | undefined;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'watcher-test-'));
});
afterEach(async () => {
  watcher?.close();
  watcher = undefined;
  await rm(directory, { recursive: true, force: true });
});

const DEBOUNCE_MS = 40;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function watch() {
  const onChange = vi.fn();
  watcher = await watchDirectory(directory, { accept: isYamlFile, onChange, debounceMs: DEBOUNCE_MS });
  return onChange;
}

it('reports a burst of writes once', async () => {
  const onChange = await watch();
  for (let n = 0; n < 5; n++) await writeFile(join(directory, 'a.yaml'), `v: ${n}`);
  await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
  await pause(DEBOUNCE_MS * 4);
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('reports a save through temp file and rename once', async () => {
  const onChange = await watch();
  await writeFile(join(directory, 'a.yaml.1234.tmp'), 'v: 1');
  await rename(join(directory, 'a.yaml.1234.tmp'), join(directory, 'a.yaml'));
  await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
  await pause(DEBOUNCE_MS * 4);
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('reports renames and deletions of yaml files', async () => {
  await writeFile(join(directory, 'a.yaml'), 'v: 1');
  const onChange = await watch();
  await rename(join(directory, 'a.yaml'), join(directory, 'b.yml'));
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  await rm(join(directory, 'b.yml'));
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
});

it('ignores temp files, swap files and other file types', async () => {
  const onChange = await watch();
  for (const name of ['a.yaml.1234.tmp', '.a.yaml.swp', 'a.yaml~', '.#a.yaml', 'notes.txt', '4913']) {
    await writeFile(join(directory, name), 'x');
  }
  await pause(DEBOUNCE_MS * 6);
  expect(onChange).not.toHaveBeenCalled();
  await writeFile(join(directory, 'real.yaml'), 'v: 1');
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
});

it('keeps watching after a failing handler and stops after close', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const onChange = vi.fn().mockRejectedValueOnce(new Error('scan failed'));
    watcher = await watchDirectory(directory, { accept: isYamlFile, onChange, debounceMs: DEBOUNCE_MS });
    await writeFile(join(directory, 'a.yaml'), 'v: 1');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    await pause(DEBOUNCE_MS * 2);
    await writeFile(join(directory, 'a.yaml'), 'v: 2');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    watcher.close();
    await writeFile(join(directory, 'a.yaml'), 'v: 3');
    await pause(DEBOUNCE_MS * 4);
    expect(onChange).toHaveBeenCalledTimes(2);
  } finally {
    warn.mockRestore();
  }
});

it('creates a missing directory and reports files created in it', async () => {
  const nested = join(directory, 'later');
  const onChange = vi.fn();
  watcher = await watchDirectory(nested, { accept: isYamlFile, onChange, debounceMs: DEBOUNCE_MS });
  await writeFile(join(nested, 'a.yaml'), 'v: 1');
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
});
