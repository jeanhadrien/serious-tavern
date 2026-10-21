import { describe, expect, it } from 'vitest';
import { nodeExecutionSchema } from './models.js';
import { skipReasonText } from './skip-reason.js';

describe('skipReasonText', () => {
  it.each([
    [{ reason: 'not-needed' as const }, 'No output depends on it.'],
    [{ reason: 'inactive-inputs' as const }, 'All its inputs come from branches that were not taken.'],
    [{ reason: 'source-skipped' as const }, 'A required input comes from a node that was skipped.'],
    [
      { reason: 'source-skipped' as const, by: 'cond' },
      'A required input comes from "Condition #1", which was skipped.',
    ],
    [{ reason: 'source-skipped' as const, by: 'gone' }, 'A required input comes from a node that was skipped.'],
  ])('%j', (skip, expected) => {
    expect(skipReasonText(skip, (id) => (id === 'cond' ? 'Condition #1' : undefined))).toBe(expected);
  });
});

describe('a node execution log', () => {
  it('reads a skip reason, and reads an old or unreadable one as none', () => {
    const base = { status: 'skipped' };
    expect(nodeExecutionSchema.parse({ ...base, skip: { reason: 'not-needed' } }).skip).toEqual({
      reason: 'not-needed',
    });
    expect(nodeExecutionSchema.parse(base).skip).toBeUndefined();
    expect(nodeExecutionSchema.parse({ ...base, skip: { reason: 'from-the-future' } }).skip).toBeUndefined();
    expect(nodeExecutionSchema.parse({ ...base, skip: 'because' }).skip).toBeUndefined();
  });
});
