import { expect, it, vi } from 'vitest';
import { warnBeforeUnload } from './useUnsavedWarning.js';

it('asks the browser for its leave-site warning', () => {
  const event = { preventDefault: vi.fn(), returnValue: 'x' } as unknown as BeforeUnloadEvent;
  warnBeforeUnload(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.returnValue).toBe('');
});
