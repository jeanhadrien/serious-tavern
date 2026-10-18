import { describe, expect, it } from 'vitest';
import { plainPreview } from './preview.js';

describe('plainPreview', () => {
  it.each([
    [
      '## Scene so far\n\n- They talked for **4 lines**\n- Starting with: user: Question 1',
      'Scene so far They talked for 4 lines Starting with: user: Question 1',
    ],
    ['1. first\n2. second', 'first second'],
    ['> quoted `code` and _emphasis_', 'quoted code and emphasis'],
    ['plain text', 'plain text'],
    ['   ', ''],
  ])('%j', (text, expected) => {
    expect(plainPreview(text)).toBe(expected);
  });
});
