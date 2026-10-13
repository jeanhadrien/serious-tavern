import { expect, it } from 'vitest';
import { isKnownPath, resourceForPath } from './routes.js';

it('maps resource paths to resources and leaves the chat path alone', () => {
  expect(resourceForPath('/presets')).toBe('presets');
  expect(resourceForPath('/workflows')).toBe('workflows');
  expect(resourceForPath('/')).toBeUndefined();
  expect(isKnownPath('/')).toBe(true);
  expect(isKnownPath('/settings')).toBe(true);
  expect(isKnownPath('/nope')).toBe(false);
});
