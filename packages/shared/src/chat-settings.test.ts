import { describe, expect, it } from 'vitest';
import {
  describeSettingValue,
  resolveChatSettings,
  settingDefault,
  settingLabel,
  settingsCatalog,
  settingValueProblem,
  workflowSettingIssues,
  workflowSettings,
  type WorkflowSetting,
} from './chat-settings.js';
import { executionLogSchema, sessionSchema, workflowSchema } from './models.js';

const number = (extra: Partial<Extract<WorkflowSetting, { type: 'number' }>> = {}): WorkflowSetting => ({
  key: 'v',
  type: 'number',
  default: 0.3,
  ...extra,
});
const boolean: WorkflowSetting = { key: 'on', type: 'boolean', default: false };
const enumSetting = (extra: Partial<Extract<WorkflowSetting, { type: 'enum' }>> = {}): WorkflowSetting => ({
  key: 'mode',
  type: 'enum',
  options: ['calm', 'tense'],
  default: 'tense',
  ...extra,
});
const text: WorkflowSetting = { key: 'note', type: 'text', default: '' };

describe('resolveChatSettings', () => {
  it.each<[string, WorkflowSetting, Record<string, unknown> | undefined, unknown, string | undefined]>([
    ['uses a fitting stored number', number(), { v: 0.8 }, 0.8, undefined],
    ['uses the default when nothing is stored', number(), {}, 0.3, undefined],
    ['uses the default when stored is undefined', number(), undefined, 0.3, undefined],
    [
      'rejects a number stored as text',
      number(),
      { v: '5' },
      0.3,
      'Stored value "5" is not a number; using default 0.3',
    ],
    [
      'rejects a number above max',
      number({ max: 10, default: 3 }),
      { v: 12 },
      3,
      'Stored value 12 is above max 10; using default 3',
    ],
    [
      'rejects a number below min',
      number({ min: 0 }),
      { v: -1 },
      0.3,
      'Stored value -1 is below min 0; using default 0.3',
    ],
    ['accepts a number on the bounds', number({ min: 0, max: 1 }), { v: 1 }, 1, undefined],
    ['rejects a non-finite number', number(), { v: null }, 0.3, 'Stored value null is not a number; using default 0.3'],
    ['uses a stored boolean', boolean, { on: true }, true, undefined],
    [
      'rejects a boolean stored as text',
      boolean,
      { on: 'true' },
      false,
      'Stored value "true" is not true or false; using default false',
    ],
    ['uses a stored option', enumSetting(), { mode: 'calm' }, 'calm', undefined],
    [
      'rejects a value that is not an option',
      enumSetting(),
      { mode: 'wild' },
      'tense',
      'Stored value "wild" is not one of: calm, tense; using default "tense"',
    ],
    ['falls back to the first option without a default', enumSetting({ default: undefined }), {}, 'calm', undefined],
    [
      'falls back to the first option when the default is not one',
      enumSetting({ default: 'x' }),
      {},
      'calm',
      undefined,
    ],
    ['uses stored text', text, { note: 'Rain.' }, 'Rain.', undefined],
    ['rejects text stored as a number', text, { note: 5 }, '', 'Stored value 5 is not text; using default ""'],
  ])('%s', (_name, setting, stored, value, issue) => {
    const result = resolveChatSettings([setting], stored);
    expect(result.values).toEqual({ [setting.key]: value });
    expect(result.issues).toEqual(issue ? [{ key: setting.key, message: issue }] : []);
  });

  it('ignores stored keys the workflow does not declare and never modifies what is stored', () => {
    const stored = Object.freeze({ v: 'bad', ghost: 1 });
    const result = resolveChatSettings([number(), boolean], stored);
    expect(result.values).toEqual({ v: 0.3, on: false });
    expect(result.issues).toHaveLength(1);
    expect(stored).toEqual({ v: 'bad', ghost: 1 });
  });

  it('skips keys templates cannot read, so a reserved key never reaches the prototype', () => {
    const declarations = workflowSettings({ settings: [{ key: '__proto__', type: 'text', default: 'x' }] });
    const result = resolveChatSettings(declarations, JSON.parse('{"__proto__": "y"}'));
    expect(result.values).toEqual({});
    expect(Object.getPrototypeOf(result.values)).toBe(Object.prototype);
  });

  it('lets the first declaration of a duplicated key win', () => {
    expect(resolveChatSettings([number({ default: 1 }), number({ default: 2 })], {}).values).toEqual({ v: 1 });
  });
});

describe('settingValueProblem', () => {
  it.each<[WorkflowSetting, unknown, string | undefined]>([
    [number(), 1, undefined],
    [number(), Number.POSITIVE_INFINITY, 'is not a number'],
    [number(), Number.NaN, 'is not a number'],
    [number({ max: 1 }), 1.5, 'is above max 1'],
    [number({ min: 2 }), 1, 'is below min 2'],
    [boolean, 0, 'is not true or false'],
    [enumSetting(), 'calm', undefined],
    [enumSetting(), 1, 'is not one of: calm, tense'],
    [text, '', undefined],
    [text, null, 'is not text'],
  ])('%j with %j', (setting, value, problem) => {
    expect(settingValueProblem(setting, value)).toBe(problem);
  });
});

describe('helpers', () => {
  it('labels a setting by its label, or its key', () => {
    expect(settingLabel({ key: 'v', label: 'Volatility' })).toBe('Volatility');
    expect(settingLabel({ key: 'v', label: ' ' })).toBe('v');
    expect(settingLabel({ key: 'v' })).toBe('v');
  });

  it('gives an enum without options an empty default', () => {
    expect(settingDefault(enumSetting({ options: [], default: undefined }))).toBe('');
  });

  it('describes values briefly', () => {
    expect(describeSettingValue(3)).toBe('3');
    expect(describeSettingValue('x')).toBe('"x"');
    expect(describeSettingValue(undefined)).toBe('nothing');
    expect(describeSettingValue('a'.repeat(60))).toHaveLength(40);
  });

  it('builds a catalog of every valid key across workflows, first declaration first', () => {
    const catalog = settingsCatalog([
      {
        settings: [
          { key: 'b', type: 'text' },
          { key: '1bad', type: 'text' },
        ],
      },
      {},
      {
        settings: [
          { key: 'a', type: 'number' },
          { key: 'b', type: 'boolean' },
        ],
      },
    ]);
    expect(catalog.map((setting) => [setting.key, setting.type])).toEqual([
      ['a', 'number'],
      ['b', 'text'],
    ]);
  });
});

describe('workflowSettings', () => {
  it('parses declarations with defaults, drops unknown types and keeps unknown fields', () => {
    const settings = workflowSettings({
      settings: [
        { key: 'a', type: 'number', extra: 1 },
        { key: 'b', type: 'color' },
        { key: 'c', type: 'enum', options: ['x'] },
      ],
    });
    expect(settings).toEqual([
      { key: 'a', type: 'number', default: 0, extra: 1 },
      { key: 'c', type: 'enum', options: ['x'] },
    ]);
    expect(workflowSettings({})).toEqual([]);
  });
});

describe('workflowSettingIssues', () => {
  it.each<[string, unknown, Omit<ReturnType<typeof workflowSettingIssues>[number], 'index'>]>([
    [
      'an unknown type',
      { key: 'a', type: 'color' },
      {
        field: 'type',
        message: 'Chat setting #2 is not valid: its type "color" is not one of: number, boolean, enum, text.',
      },
    ],
    [
      'a bad field',
      { key: 'a', type: 'number', min: 'x' },
      { field: 'type', message: 'Chat setting #2 is not valid: min: Invalid input: expected number, received string.' },
    ],
    ['an empty key', { key: '', type: 'text' }, { field: 'key', message: 'Chat setting #2 needs a key.' }],
    [
      'a key templates cannot use',
      { key: '1st', type: 'text' },
      {
        field: 'key',
        message:
          'Chat setting #2 has the key "1st", which can\'t be used in templates: use letters, digits and _, not starting with a digit.',
      },
    ],
    [
      'a reserved key',
      { key: '__proto__', type: 'text' },
      { field: 'key', message: 'Chat setting #2 has the reserved key "__proto__"; pick another.' },
    ],
    [
      'a duplicate key',
      { key: 'ok', type: 'boolean' },
      { field: 'key', message: 'More than one chat setting uses the key "ok"; keys must be unique.' },
    ],
    [
      'min above max',
      { key: 'v', type: 'number', min: 5, max: 1, default: 3 },
      { field: 'min', message: 'Chat setting "v": min 5 is greater than max 1.' },
    ],
    [
      'a default above max',
      { key: 'v', type: 'number', max: 1, default: 3 },
      { field: 'default', message: 'Chat setting "v": the default 3 is above max 1.' },
    ],
    [
      'a default below min',
      { key: 'v', type: 'number', min: 1 },
      { field: 'default', message: 'Chat setting "v": the default 0 is below min 1.' },
    ],
    [
      'a step that is not positive',
      { key: 'v', type: 'number', step: 0 },
      { field: 'step', message: 'Chat setting "v": the step must be greater than 0.' },
    ],
    [
      'an enum without options',
      { key: 'mood', type: 'enum' },
      { field: 'options', message: 'Chat setting "mood" needs at least one option.' },
    ],
    [
      'an enum default that is not an option',
      { key: 'mood', type: 'enum', options: ['calm'], default: 'x' },
      { field: 'default', message: 'Chat setting "mood": the default "x" is not one of its options.' },
    ],
  ])('reports %s', (_name, item, issue) => {
    expect(workflowSettingIssues([{ key: 'ok', type: 'text' }, item])).toEqual([{ index: 1, ...issue }]);
  });

  it('finds nothing wrong with valid declarations, or none', () => {
    expect(
      workflowSettingIssues([
        { key: 'volatility', type: 'number', default: 0.3, min: 0, max: 1, step: 0.05 },
        { key: 'on', type: 'boolean' },
        { key: 'mood', type: 'enum', options: ['calm', 'tense'] },
        { key: '_note', type: 'text', multiline: true },
      ]),
    ).toEqual([]);
    expect(workflowSettingIssues(undefined)).toEqual([]);
    expect(workflowSettingIssues([])).toEqual([]);
  });
});

describe('schemas', () => {
  const base = { id: 'w', name: 'W', nodes: [], edges: [], createdAt: '', updatedAt: '' };
  it('loads workflows with and without settings, keeping unknown declaration fields', () => {
    expect(workflowSchema.parse(base)).not.toHaveProperty('settings');
    const parsed = workflowSchema.parse({ ...base, settings: [{ key: 'a', type: 'boolean', future: 'x' }] });
    expect(parsed.settings).toEqual([{ key: 'a', type: 'boolean', default: false, future: 'x' }]);
  });

  it('keeps session values and execution settings', () => {
    const session = { id: 's', title: 'S', workflowId: 'w', messages: [], createdAt: '', updatedAt: '' };
    expect(sessionSchema.parse(session)).not.toHaveProperty('settings');
    expect(sessionSchema.parse({ ...session, settings: { a: 1, b: 'x' } }).settings).toEqual({ a: 1, b: 'x' });
    const execution = { id: 'e', workflowId: 'w', sessionId: 's', status: 'completed', startedAt: '', nodes: {} };
    expect(executionLogSchema.parse({ ...execution, settings: { a: 1 } }).settings).toEqual({ a: 1 });
  });
});
