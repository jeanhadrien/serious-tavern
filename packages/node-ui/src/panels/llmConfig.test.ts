import { expect, it } from 'vitest';
import { parseStopSequences, updateNumericOption } from './llmConfig.js';

it('sets numeric samplers and removes blank optional samplers without changing other config', () => {
  const config = { model: 'model', temperature: 0.7, topP: 0.9 };
  expect(updateNumericOption(config, 'temperature', '0')).toEqual({ ...config, temperature: 0 });
  expect(updateNumericOption(config, 'maxTokens', '1024')).toEqual({ ...config, maxTokens: 1024 });
  expect(updateNumericOption(config, 'topP', '')).toEqual({ model: 'model', temperature: 0.7 });
  expect(config.topP).toBe(0.9);
});

it('preserves stop sequence line semantics and distinguishes blank input from empty lines', () => {
  expect(parseStopSequences('')).toBeUndefined();
  expect(parseStopSequences('\n')).toEqual([]);
  expect(parseStopSequences('END\n\n stop \n')).toEqual(['END', ' stop ']);
});
