import { watch, type FSWatcher } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';

export interface DirectoryWatcher {
  close(): void;
}

export interface DirectoryWatchOptions {
  /** Which file names matter; events for other names (temp files, swap files) are ignored. */
  accept(fileName: string): boolean;
  /** Called once per burst of changes, after `debounceMs` of quiet. Never runs concurrently with itself. */
  onChange(): void | Promise<void>;
  debounceMs?: number;
  /** Delay before re-arming a watcher that failed. */
  rearmMs?: number;
}

/**
 * Watches one directory (non-recursive) and reports debounced bursts of changes. A save through
 * temp file + rename produces several raw events but a single `onChange`. Raw events carry no reliable
 * detail, so callers rescan the directory in `onChange`. Errors are logged and the watcher re-arms itself;
 * the watcher never keeps the process alive.
 */
export async function watchDirectory(directory: string, options: DirectoryWatchOptions): Promise<DirectoryWatcher> {
  const { accept, onChange, debounceMs = 150, rearmMs = 1000 } = options;
  let closed = false;
  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rearmTimer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;

  const run = async () => {
    timer = undefined;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        try {
          await onChange();
        } catch (error) {
          console.warn(`Directory change handler failed for ${directory}: ${(error as Error).message}`);
        }
      } while (again && !closed);
    } finally {
      running = false;
    }
  };
  const schedule = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), debounceMs);
    timer.unref();
  };
  const arm = async () => {
    if (closed) return;
    try {
      await mkdir(directory, { recursive: true });
      // libuv asserts (and aborts the whole process) when Windows reports a long file name for a directory
      // given by its 8.3 short name (e.g. C:\Users\JEANHA~1\...), so always watch the resolved path.
      watcher = watch(await realpath(directory), { persistent: false }, (_event, fileName) => {
        // A null name means the platform could not say which file changed.
        if (fileName === null || accept(fileName.toString())) schedule();
      });
      watcher.on('error', (error) => {
        console.warn(`Watching ${directory} failed, retrying: ${error.message}`);
        watcher?.close();
        watcher = undefined;
        rearm();
      });
    } catch (error) {
      console.warn(`Could not watch ${directory}, retrying: ${(error as Error).message}`);
      rearm();
    }
  };
  // After a failure events may have been missed, so a rescan is scheduled once the watcher is back.
  const rearm = () => {
    if (closed) return;
    rearmTimer = setTimeout(() => {
      void arm().then(schedule);
    }, rearmMs);
    rearmTimer.unref();
  };

  await arm();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      clearTimeout(rearmTimer);
      watcher?.close();
      watcher = undefined;
    },
  };
}
