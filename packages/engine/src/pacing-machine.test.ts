import { describe, expect, it } from 'vitest';
import { configSchema, DEFAULT_GUIDANCE, type PacingConfig } from './nodes/pacing/config.js';
import { replay, step, type DirectorState, type TurnInput } from './nodes/pacing/machine.js';

const config = (overrides: Record<string, unknown> = {}) => configSchema.parse(overrides) as PacingConfig;
const at = (phase: DirectorState['phase'], intensity: number, turnsInPhase: number): DirectorState => ({
  phase,
  intensity,
  turnsInPhase,
});

describe('Pacing config', () => {
  it('has the documented defaults', () => {
    expect(config()).toEqual({
      decay: 0.85,
      peakThreshold: 0.7,
      relaxThreshold: 0.3,
      maxBuildTurns: 8,
      peakTurns: 2,
      fadeTurns: 3,
      relaxTurns: 3,
      buildStartLevel: 2,
      buildMaxLevel: 4,
      peakLevel: 5,
      quietLevel: 1,
      peakPressure: 0.1,
      guidanceBuild: DEFAULT_GUIDANCE.build,
      guidancePeak: DEFAULT_GUIDANCE.peak,
      guidanceFade: DEFAULT_GUIDANCE.fade,
      guidanceRelax: DEFAULT_GUIDANCE.relax,
    });
  });

  it.each([
    [{ decay: 1.5 }, 'Decay must be between 0 and 1'],
    [{ peakThreshold: -1 }, 'Peak threshold must be between 0 and 1'],
    [{ maxBuildTurns: 0 }, 'Max build turns must be at least 1 turn'],
    [{ relaxTurns: 0 }, 'Relax turns must be at least 1 turn'],
    [{ peakTurns: 1.5 }, undefined],
    [{ peakLevel: 6 }, 'Peak level goes from 1 to 5'],
    [{ quietLevel: 0 }, 'Quiet level goes from 1 to 5'],
    [{ relaxThreshold: 0.9, peakThreshold: 0.5 }, 'Relax threshold can not be above the peak threshold'],
    [{ buildStartLevel: 5, buildMaxLevel: 3 }, 'Build max level must be at least the build start level'],
  ])('rejects %j', (overrides, message) => {
    const result = configSchema.safeParse(overrides);
    expect(result.success).toBe(false);
    if (message) expect(result.error!.issues.map((issue) => issue.message).join('\n')).toContain(message);
  });
});

describe('Pacing transitions (with tension)', () => {
  // [name, previous state, tension, hold, expected phase, turns in phase, intensity]
  it.each<[string, DirectorState | undefined, number | undefined, boolean, string, number, number]>([
    ['the first turn starts a build', undefined, 0.2, false, 'build', 1, 0.2],
    ['a build goes on while intensity stays low', at('build', 0.5, 3), 0.2, false, 'build', 4, 0.425],
    ['a build peaks when intensity reaches the threshold', at('build', 0.5, 3), 0.9, false, 'peak', 1, 0.9],
    ['a build peaks at exactly the threshold', at('build', 0.5, 3), 0.7, false, 'peak', 1, 0.7],
    ['a stalled build peaks after the longest build', at('build', 0.1, 8), 0.1, false, 'peak', 1, 0.1],
    ['a build one turn short of the longest goes on', at('build', 0.1, 7), 0.1, false, 'build', 8, 0.1],
    ['a peak is sustained for its minimum', at('peak', 0.9, 1), 0.9, false, 'peak', 2, 0.9],
    ['a peak fades after its turns, whatever the tension', at('peak', 0.9, 2), 1, false, 'fade', 1, 1],
    ['a fade goes on while intensity is still high', at('fade', 0.5, 1), 0, false, 'fade', 2, 0.425],
    ['a fade relaxes when intensity falls below the threshold', at('fade', 0.3, 1), 0, false, 'relax', 1, 0.255],
    ['a fade relaxes after the longest fade', at('fade', 0.9, 3), 0.9, false, 'relax', 1, 0.9],
    ['a relax lasts its window', at('relax', 0.1, 2), 0.9, false, 'relax', 3, 0.9],
    ['a relax ends into a build, whatever the tension', at('relax', 0.1, 3), 0.9, false, 'build', 1, 0.9],
    ['hold keeps the phase and its turn count', at('build', 0.5, 3), undefined, true, 'build', 3, 0.5],
    ['hold keeps a build that would have peaked', at('build', 0.5, 3), 0.9, true, 'build', 3, 0.9],
    ['hold keeps a peak that would have faded', at('peak', 0.9, 2), 0.9, true, 'peak', 2, 0.9],
    ['hold keeps a relax that would have ended', at('relax', 0.1, 3), 0, true, 'relax', 3, 0.085],
  ])('%s', (_name, previous, tension, hold, phase, turns, intensity) => {
    const { next, outputs } = step(previous, { ...(tension !== undefined && { tension }), hold }, config());
    expect(next).toEqual({ phase, turnsInPhase: turns, intensity: expect.closeTo(intensity, 10) });
    expect(outputs).toMatchObject({ phase, turnsInPhase: turns, intensity: expect.closeTo(intensity, 10) });
  });

  it('clamps a tension outside 0..1', () => {
    expect(step(at('build', 0, 1), { tension: 7 }, config()).next.intensity).toBe(1);
    expect(step(at('build', 0.4, 1), { tension: -3 }, config()).next.intensity).toBeCloseTo(0.34);
  });

  it('lets the intensity decay by the configured factor', () => {
    expect(step(at('build', 0.5, 1), { tension: 0 }, config({ decay: 0.5 })).next.intensity).toBe(0.25);
    expect(step(at('build', 0.5, 1), { tension: 0 }, config({ decay: 0 })).next.intensity).toBe(0);
  });

  it('follows the thresholds and durations of the config', () => {
    const custom = config({
      peakThreshold: 0.5,
      relaxThreshold: 0.1,
      maxBuildTurns: 2,
      peakTurns: 1,
      fadeTurns: 1,
      relaxTurns: 1,
    });
    expect(step(at('build', 0, 2), {}, custom).next.phase).toBe('peak');
    expect(step(at('peak', 1, 1), {}, custom).next.phase).toBe('fade');
    expect(step(at('fade', 1, 1), {}, custom).next.phase).toBe('relax');
    expect(step(at('relax', 0, 1), {}, custom).next.phase).toBe('build');
  });
});

describe('Pacing beat clock (no tension)', () => {
  const run = (turns: number, overrides: Record<string, unknown> = {}) => {
    const settings = config(overrides);
    const states: DirectorState[] = [];
    let state: DirectorState | undefined;
    for (let n = 0; n < turns; n++) {
      state = step(state, {}, settings).next;
      states.push(state);
    }
    return states;
  };

  it('cycles through every phase for the documented durations and starts over', () => {
    const phases = run(18).map(({ phase, turnsInPhase }) => `${phase}${turnsInPhase}`);
    expect(phases).toEqual([
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `build${n}`),
      'peak1',
      'peak2',
      'fade1',
      'fade2',
      'fade3',
      'relax1',
      'relax2',
      'relax3',
      'build1',
      'build2',
    ]);
  });

  it('ramps the intensity up in a build, holds it high in the peak and lets it fall after', () => {
    const states = run(17);
    const build = states.slice(0, 8).map((state) => state.intensity);
    expect(build[0]).toBeCloseTo(0.0875);
    expect(build[7]).toBeCloseTo(0.7);
    for (let n = 1; n < build.length; n++) expect(build[n]).toBeGreaterThan(build[n - 1]!);
    expect(states[8]!.intensity).toBe(1);
    expect(states[9]!.intensity).toBe(1);
    // Fade and relax decay by 0.85 a turn.
    expect(states[10]!.intensity).toBeCloseTo(0.85);
    expect(states[13]!.intensity).toBeCloseTo(0.85 ** 4);
    expect(states[15]!.intensity).toBeCloseTo(0.85 ** 6);
  });

  it('follows a shorter build when the config says so', () => {
    const phases = run(5, { maxBuildTurns: 2 }).map((state) => state.phase);
    expect(phases).toEqual(['build', 'build', 'peak', 'peak', 'fade']);
  });
});

describe('Pacing outputs', () => {
  it('ramps max level and pressure with the turns in a build', () => {
    const settings = config();
    const levels: number[] = [];
    const pressure: number[] = [];
    for (let turns = 1; turns <= 8; turns++) {
      const { outputs } = step(at('build', 0, turns - 1), { tension: 0 }, settings);
      expect(outputs.phase).toBe('build');
      levels.push(outputs.maxLevel);
      pressure.push(outputs.pressure);
    }
    expect(levels).toEqual([2, 2, 3, 3, 3, 3, 4, 4]);
    expect(pressure[0]).toBe(0);
    expect(pressure[7]).toBe(1);
    expect(pressure.map((value) => Number(value.toFixed(3)))).toEqual([0, 0.143, 0.286, 0.429, 0.571, 0.714, 0.857, 1]);
  });

  it('gives the peak its level and a low pressure, and the quiet phases level 1 and no pressure', () => {
    const settings = config();
    expect(step(at('peak', 1, 1), {}, settings).outputs).toMatchObject({ phase: 'peak', maxLevel: 5, pressure: 0.1 });
    expect(step(at('peak', 1, 2), {}, settings).outputs).toMatchObject({ phase: 'fade', maxLevel: 1, pressure: 0 });
    expect(step(at('fade', 1, 3), {}, settings).outputs).toMatchObject({ phase: 'relax', maxLevel: 1, pressure: 0 });
    expect(step(at('relax', 0, 1), {}, settings).outputs).toMatchObject({ phase: 'relax', maxLevel: 1, pressure: 0 });
  });

  it('uses the configured levels and a build of one turn', () => {
    const settings = config({
      buildStartLevel: 3,
      buildMaxLevel: 3,
      peakLevel: 4,
      quietLevel: 2,
      peakPressure: 0.4,
      maxBuildTurns: 1,
    });
    expect(step(undefined, {}, settings).outputs).toMatchObject({ phase: 'build', maxLevel: 3, pressure: 1 });
    expect(step(at('build', 0.7, 1), {}, settings).outputs).toMatchObject({
      phase: 'peak',
      maxLevel: 4,
      pressure: 0.4,
    });
    expect(step(at('peak', 1, 2), {}, settings).outputs).toMatchObject({ phase: 'fade', maxLevel: 2 });
  });

  it('gives each phase its guidance, which the config can replace', () => {
    const settings = config({ guidanceRelax: 'Breathe.' });
    expect(step(undefined, {}, settings).outputs.guidance).toBe(DEFAULT_GUIDANCE.build);
    expect(step(at('build', 0.8, 2), { tension: 0.9 }, settings).outputs.guidance).toBe(DEFAULT_GUIDANCE.peak);
    expect(step(at('peak', 1, 2), {}, settings).outputs.guidance).toBe(DEFAULT_GUIDANCE.fade);
    expect(step(at('fade', 1, 3), {}, settings).outputs.guidance).toBe('Breathe.');
    expect(DEFAULT_GUIDANCE.relax).toContain('let the scene breathe');
  });

  it('explains the transition and the turn count', () => {
    const settings = config();
    expect(step(at('peak', 1, 2), {}, settings).outputs.reason).toContain('peak → fade after 2 turns');
    expect(step(at('build', 0.5, 3), { tension: 0.9 }, settings).outputs.reason).toContain(
      'build → peak intensity 0.9 reached the peak threshold 0.7',
    );
    expect(step(at('build', 0.1, 8), { tension: 0.1 }, settings).outputs.reason).toContain(
      'build → peak after 8 turns (the longest build)',
    );
    expect(step(at('fade', 0.3, 1), { tension: 0 }, settings).outputs.reason).toContain(
      'fade → relax intensity 0.26 fell below 0.3',
    );
    expect(step(at('relax', 0.1, 1), {}, settings).outputs.reason).toContain('relax, turn 2; intensity');
    expect(step(at('build', 0.5, 3), { hold: true }, settings).outputs.reason).toContain('holding build at turn 3');
    expect(step(at('build', 0.5, 3), { tension: 0.2 }, settings).outputs.reason).toContain('(tension 0.2)');
    expect(step(at('build', 0.5, 3), {}, settings).outputs.reason).toContain('(beat clock)');
  });
});

describe('replay', () => {
  it('is the step folded over the turns, and nothing without turns', () => {
    const settings = config();
    const turns: TurnInput[] = [{ tension: 0.2 }, { tension: 0.9 }, { hold: true }, {}];
    let state: DirectorState | undefined;
    for (const input of turns) state = step(state, input, settings).next;
    expect(replay(turns, settings)).toEqual(state);
    expect(replay([], settings)).toBeUndefined();
  });
});
