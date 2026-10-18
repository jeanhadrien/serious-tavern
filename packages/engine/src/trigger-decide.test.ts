import { describe, expect, it } from 'vitest';
import { decide, triggerScore, type TriggerParams } from './nodes/trigger/decide.js';
import { DEFAULT_COOLDOWNS, DEFAULT_LEVEL_WEIGHTS } from './nodes/trigger/config.js';

const params = (extra: Partial<TriggerParams> = {}): TriggerParams => ({
  turn: 1,
  baseChance: 0.1,
  growthPerTurn: 0.05,
  volatility: 0.3,
  maxLevel: 2,
  cooldowns: DEFAULT_COOLDOWNS,
  levelWeights: DEFAULT_LEVEL_WEIGHTS,
  signals: [],
  firings: [],
  ...extra,
});
/** Scripted draws: the roll first, then the level draw. */
const script = (...values: number[]) => {
  const queue = [...values];
  return () => {
    if (!queue.length) throw new Error('drew more than scripted');
    return queue.shift()!;
  };
};

describe('score', () => {
  it('counts a chat that never fired as `turn` turns since the last firing', () => {
    // (0.1 + 0.05 × 1) × 0.8
    expect(triggerScore(params()).score).toBeCloseTo(0.12);
    expect(triggerScore(params({ turn: 5 })).score).toBeCloseTo(0.28);
    expect(triggerScore(params({ turn: 5 })).since).toBe(5);
  });

  it('grows with the turns since the last firing of any level and starts over at a firing', () => {
    const firings = [{ turn: 4, level: 2 }];
    expect(triggerScore(params({ turn: 5, firings })).since).toBe(1);
    expect(triggerScore(params({ turn: 5, firings })).score).toBeCloseTo((0.1 + 0.05) * 0.8);
    expect(triggerScore(params({ turn: 9, firings })).score).toBeCloseTo((0.1 + 0.25) * 0.8);
    // The newest firing counts, whichever level.
    const mixed = [
      { turn: 8, level: 1 },
      { turn: 4, level: 2 },
    ];
    expect(triggerScore(params({ turn: 9, firings: mixed })).since).toBe(1);
  });

  it('adds weight × signal for every signal, a negative weight lowers it', () => {
    const signals = [
      { name: 'stagnation', weight: 0.6, value: 0.5 },
      { name: 'tension', weight: -0.2, value: 1 },
    ];
    expect(triggerScore(params({ signals })).score).toBeCloseTo((0.1 + 0.05 + 0.3 - 0.2) * 0.8);
  });

  it.each([
    // [volatility, factor]
    [0, 0.5],
    [0.3, 0.8],
    [1, 1.5],
  ])('scales by 0.5 + volatility (%s)', (volatility, factor) => {
    expect(triggerScore(params({ volatility })).score).toBeCloseTo(0.15 * factor);
  });

  it('is kept between 0 and 1', () => {
    const big = params({ signals: [{ name: 's', weight: 5, value: 1 }] });
    expect(triggerScore(big)).toMatchObject({ score: 1 });
    expect(triggerScore(big).raw).toBeGreaterThan(1);
    expect(triggerScore(params({ signals: [{ name: 's', weight: -5, value: 1 }] })).score).toBe(0);
  });
});

describe('firing', () => {
  it('fires when the roll is below the score, not when it equals it', () => {
    const base = params({ turn: 5 }); // score 0.28
    expect(decide(base, script(0.27, 0)).fire).toBe(true);
    expect(decide(base, script(0.28)).fire).toBe(false);
    expect(decide(base, script(0.9)).fire).toBe(false);
  });

  it('draws once when it does not fire and twice when it does', () => {
    let draws = 0;
    const counted = (value: number) => () => {
      draws++;
      return value;
    };
    decide(params({ turn: 5 }), counted(0.9));
    expect(draws).toBe(1);
    draws = 0;
    decide(params({ turn: 5 }), counted(0.1));
    expect(draws).toBe(2);
  });

  it('is the same for the same draws', () => {
    const first = decide(params({ turn: 6 }), script(0.2, 0.7));
    const second = decide(params({ turn: 6 }), script(0.2, 0.7));
    expect(second).toEqual(first);
  });

  it('never fires with a score of 0 and always with a score of 1 when a level is available', () => {
    expect(decide(params({ baseChance: 0, growthPerTurn: 0 }), script(0)).fire).toBe(false);
    expect(decide(params({ baseChance: 2 }), script(0.999, 0)).fire).toBe(true);
  });
});

describe('level choice', () => {
  const fires = (extra: Partial<TriggerParams>, level: number) =>
    decide(params({ baseChance: 1, maxLevel: 5, ...extra }), script(0, level));

  it('picks by weight among the levels up to the max level', () => {
    // Default weights 1: 5, 2: 3, 3: 2 (total 10) with max level 3.
    const at = (draw: number) => fires({ maxLevel: 3 }, draw).level;
    expect([at(0), at(0.49), at(0.5), at(0.79), at(0.8), at(0.99)]).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('never picks a level above the max level', () => {
    for (const draw of [0, 0.5, 0.99]) expect(fires({ maxLevel: 1 }, draw).level).toBe(1);
    expect(fires({ maxLevel: 2.9 }, 0.99).level).toBe(2);
  });

  it('can not fire when the max level is below 1', () => {
    const decision = fires({ maxLevel: 0.5 }, 0);
    expect(decision.fire).toBe(false);
    expect(decision.reason).toContain('but no level can fire (levels above max level 0.5 left out)');
  });

  it('never picks a level with weight 0', () => {
    const levelWeights = { ...DEFAULT_LEVEL_WEIGHTS, '1': 0 };
    for (const draw of [0, 0.5, 0.99]) expect(fires({ maxLevel: 2, levelWeights }, draw).level).toBe(2);
  });

  it('can not fire when every available level has weight 0', () => {
    const levelWeights = { '1': 0, '2': 0, '3': 1, '4': 1, '5': 1 };
    const decision = fires({ maxLevel: 2, levelWeights }, 0);
    expect(decision.fire).toBe(false);
    expect(decision.reason).toContain(
      'but no level can fire (level 1 has weight 0; level 2 has weight 0; levels above',
    );
  });
});

describe('cooldowns', () => {
  const cooldowns = { '1': 0, '2': 3, '3': 5, '4': 8, '5': 15 };
  const at = (turn: number, firings: TriggerParams['firings'], draw = 0.99) =>
    decide(params({ baseChance: 1, maxLevel: 3, cooldowns, turn, firings }), script(0, draw));

  it('holds a level until its cooldown has passed, counted from that level’s last firing', () => {
    const firings = [{ turn: 10, level: 2 }];
    // Level 2 has a cooldown of 3 turns: blocked on turns 11 and 12, free again on turn 13.
    expect(at(11, firings, 0.6).level).not.toBe(2);
    expect(at(12, firings, 0.6).level).not.toBe(2);
    expect(at(13, firings, 0.6).level).toBe(2);
  });

  it('has a separate cooldown for each level', () => {
    // Level 3 fired last turn; level 2 is still free and level 1 has no cooldown.
    const firings = [{ turn: 10, level: 3 }];
    expect(at(11, firings, 0.99).level).toBe(2);
    expect(at(11, firings, 0).level).toBe(1);
  });

  it('uses the most recent firing of a level', () => {
    const firings = [
      { turn: 10, level: 2 },
      { turn: 2, level: 2 },
    ];
    expect(at(11, firings, 0.6).level).not.toBe(2);
  });

  it('a cooldown of 0 is never on cooldown, even right after a firing', () => {
    expect(at(11, [{ turn: 10, level: 1 }], 0).level).toBe(1);
  });

  it('does not fire when every level up to the max level is on cooldown, and says for how long', () => {
    const firings = [
      { turn: 10, level: 3 },
      { turn: 9, level: 2 },
      { turn: 8, level: 1 },
    ];
    const blocked = decide(
      params({ baseChance: 2, maxLevel: 3, cooldowns: { ...cooldowns, '1': 4 }, turn: 11, firings }),
      script(0),
    );
    expect(blocked.fire).toBe(false);
    expect(blocked.reason).toBe(
      'score 1 (capped from 1.64) = (2 + 0.05×1) × 0.8; ' +
        'roll 0 < 1 but no level can fire (level 1 on cooldown for 1 more turn; level 2 on cooldown for 1 more turn; ' +
        'level 3 on cooldown for 4 more turns; levels above max level 3 left out)',
    );
  });

  it('ignores the cooldown of a level above the max level', () => {
    const firings = [{ turn: 10, level: 5 }];
    expect(at(11, firings, 0).level).toBe(1);
  });
});

describe('reason', () => {
  it('explains a miss', () => {
    const decision = decide(params({ turn: 4 }), script(0.31));
    expect(decision.reason).toBe('score 0.24 = (0.1 + 0.05×4) × 0.8; roll 0.31 ≥ 0.24: no firing');
  });

  it('explains a firing with the signals, the level and the cooldowns', () => {
    const decision = decide(
      params({
        turn: 4,
        signals: [{ name: 'stagnation', weight: 0.6, value: 0.2 }],
        firings: [{ turn: 1, level: 1 }],
        cooldowns: { ...DEFAULT_COOLDOWNS, '1': 5 },
      }),
      script(0.1, 0.99),
    );
    // since = 3: (0.1 + 0.15 + 0.12) × 0.8 = 0.296
    expect(decision.reason).toBe(
      'score 0.296 = (0.1 + 0.05×3 + 0.6×0.2 stagnation) × 0.8; roll 0.1 < 0.296; level 2 chosen ' +
        '(level 1 on cooldown for 2 more turns; levels above max level 2 left out)',
    );
    expect(decision).toMatchObject({ fire: true, level: 2 });
  });

  it('shows a negative weight as a subtraction', () => {
    const decision = decide(
      params({ maxLevel: 5, signals: [{ name: 'calm', weight: -0.1, value: 1 }], turn: 2 }),
      script(0.99),
    );
    expect(decision.reason).toBe('score 0.08 = (0.1 + 0.05×2 - 0.1×1 calm) × 0.8; roll 0.99 ≥ 0.08: no firing');
  });
});
