import { describe, expect, it } from 'vitest';
import { listedSettings, replyWorkflows } from './triggers.js';

const legacy = [{ workflowId: 'w0', enabled: true }];

describe('replyWorkflows', () => {
  it.each<[string, unknown, unknown[]]>([
    ['no triggers (every older chat)', undefined, legacy],
    ['triggers that are not an object', 'nope', legacy],
    ['triggers without a reply list', {}, legacy],
    ['a reply list that is not an array', { reply: 'x' }, legacy],
    ['an empty reply list', { reply: [] }, legacy],
    ['a list whose entries all fail to parse', { reply: [{}, { workflowId: 3, enabled: true }, null, 'w1'] }, legacy],
    [
      'the stored list, in order, toggles kept',
      {
        reply: [
          { workflowId: 'w2', enabled: false },
          { workflowId: 'w1', enabled: true },
        ],
      },
      [
        { workflowId: 'w2', enabled: false },
        { workflowId: 'w1', enabled: true },
      ],
    ],
    [
      'entries that do not parse skipped',
      { reply: [{ workflowId: 'w1' }, { workflowId: 'w2', enabled: true }, { workflowId: '', enabled: true }] },
      [{ workflowId: 'w2', enabled: true }],
    ],
    [
      'a repeated workflow keeping its first entry',
      {
        reply: [
          { workflowId: 'w1', enabled: false },
          { workflowId: 'w2', enabled: true },
          { workflowId: 'w1', enabled: true },
        ],
      },
      [
        { workflowId: 'w1', enabled: false },
        { workflowId: 'w2', enabled: true },
      ],
    ],
    [
      'unknown fields of an entry surviving',
      { reply: [{ workflowId: 'w1', enabled: true, note: 'x' }] },
      [{ workflowId: 'w1', enabled: true, note: 'x' }],
    ],
  ])('%s', (_, triggers, expected) => {
    expect(replyWorkflows({ workflowId: 'w0', triggers })).toEqual(expected);
  });

  it('never reads workflowId when a stored list parses (it only mirrors the first entry)', () => {
    expect(replyWorkflows({ workflowId: 'old', triggers: { reply: [{ workflowId: 'w1', enabled: true }] } })).toEqual([
      { workflowId: 'w1', enabled: true },
    ]);
  });

  it('does not change what it reads', () => {
    const triggers = {
      reply: [
        { workflowId: 'w1', enabled: true },
        { workflowId: 'w1', enabled: false },
      ],
    };
    const copy = structuredClone(triggers);
    replyWorkflows({ workflowId: 'w0', triggers });
    expect(triggers).toEqual(copy);
  });
});

describe('listedSettings', () => {
  const setting = (key: string, def: number) => ({ key, type: 'number', default: def });
  it('unions the declarations in list order, the first declaration of a key winning', () => {
    const union = listedSettings([
      { settings: [setting('tone', 1), setting('pace', 2)] },
      { settings: [setting('tone', 9), setting('depth', 3)] },
    ]);
    expect(union.map(({ key }) => key)).toEqual(['tone', 'pace', 'depth']);
    expect(union[0]).toMatchObject({ key: 'tone', default: 1 });
  });

  it('skips unusable keys and workflows without settings', () => {
    expect(listedSettings([{}, { settings: [setting('this', 1), setting('ok', 1)] }]).map(({ key }) => key)).toEqual([
      'ok',
    ]);
    expect(listedSettings([])).toEqual([]);
  });
});
