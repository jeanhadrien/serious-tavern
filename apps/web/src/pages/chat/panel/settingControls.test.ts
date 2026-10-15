import { describe, expect, it } from 'vitest';
import type { WorkflowSetting } from '@st/shared';
import { controlKind, parseNumberDraft } from './settingControls.js';

describe('chat setting controls', () => {
  it.each<[WorkflowSetting, string]>([
    [{ key: 'v', type: 'number', default: 0, min: 0, max: 1 }, 'slider'],
    [{ key: 'v', type: 'number', default: 0, min: 0 }, 'number'],
    [{ key: 'v', type: 'number', default: 0 }, 'number'],
    [{ key: 'b', type: 'boolean', default: false }, 'toggle'],
    [{ key: 'e', type: 'enum', options: ['a'] }, 'select'],
    [{ key: 't', type: 'text', default: '', multiline: true }, 'textarea'],
    [{ key: 't', type: 'text', default: '' }, 'text'],
  ])('gives %j a %s', (setting, kind) => {
    expect(controlKind(setting)).toBe(kind);
  });

  const bounded: WorkflowSetting = { key: 'v', type: 'number', default: 0, min: 0, max: 1 };
  it.each<[string, ReturnType<typeof parseNumberDraft>]>([
    ['', { problem: 'Enter a number' }],
    ['  ', { problem: 'Enter a number' }],
    ['-', { problem: '- is not a number' }],
    ['1.5', { problem: '1.5 is above max 1' }],
    ['-0.1', { problem: '-0.1 is below min 0' }],
    ['0.4', { value: 0.4 }],
    [' 1 ', { value: 1 }],
  ])('reads %j', (text, expected) => {
    expect(parseNumberDraft(text, bounded)).toEqual(expected);
  });
});
