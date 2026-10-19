import type { PacingConfig } from './config.js';

type Phase = 'build' | 'peak' | 'fade' | 'relax';

/** Where the director stands after a turn: the phase that turn ran in, and how many turns (that one included) it has lasted. */
export type DirectorState = { phase: Phase; intensity: number; turnsInPhase: number };

/** What one turn gives the director. Both are optional: no tension is the beat clock, no hold lets the phase advance. */
export type TurnInput = { tension?: number; hold?: boolean };

export type PacingOutputs = {
  phase: Phase;
  intensity: number;
  maxLevel: number;
  pressure: number;
  turnsInPhase: number;
  guidance: string;
  reason: string;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const fmt = (value: number) => String(Number(value.toFixed(2)));
const turnsText = (count: number) => `${count} turn${count === 1 ? '' : 's'}`;

/** Before the first turn: the story is building, nothing has happened yet. */
const START: DirectorState = { phase: 'build', intensity: 0, turnsInPhase: 0 };
const NEXT: Record<Phase, Phase> = { build: 'peak', peak: 'fade', fade: 'relax', relax: 'build' };

/**
 * Why `phase` ends now, or undefined when it goes on. `turns` is how many turns it has lasted so far and `intensity`
 * the intensity as measured for this turn. One transition per turn at most.
 */
function exitReason(phase: Phase, turns: number, intensity: number, config: PacingConfig): string | undefined {
  switch (phase) {
    case 'build':
      if (intensity >= config.peakThreshold)
        return `intensity ${fmt(intensity)} reached the peak threshold ${fmt(config.peakThreshold)}`;
      return turns >= config.maxBuildTurns ? `after ${turnsText(turns)} (the longest build)` : undefined;
    case 'peak':
      return turns >= config.peakTurns ? `after ${turnsText(turns)}` : undefined;
    case 'fade':
      if (intensity < config.relaxThreshold)
        return `intensity ${fmt(intensity)} fell below ${fmt(config.relaxThreshold)}`;
      return turns >= config.fadeTurns ? `after ${turnsText(turns)} (the longest fade)` : undefined;
    case 'relax':
      return turns >= config.relaxTurns ? `after ${turnsText(turns)}` : undefined;
  }
}

/** The tension the beat clock stands in for: build ramps up to the peak threshold, the peak is full, then nothing. */
function beat(phase: Phase, turns: number, config: PacingConfig): number {
  if (phase === 'build') return config.peakThreshold * Math.min(1, turns / config.maxBuildTurns);
  return phase === 'peak' ? 1 : 0;
}

/** What the phase lets the story do: how big an event may be and how hard the Trigger should push for one. */
function shape(phase: Phase, turns: number, config: PacingConfig): Pick<PacingOutputs, 'maxLevel' | 'pressure'> {
  if (phase === 'build') {
    // 0 on the first turn of a build, 1 on the last one it can have, so a stalled build pushes harder every turn.
    const progress = config.maxBuildTurns <= 1 ? 1 : clamp01((turns - 1) / (config.maxBuildTurns - 1));
    return {
      maxLevel: Math.round(config.buildStartLevel + (config.buildMaxLevel - config.buildStartLevel) * progress),
      pressure: progress,
    };
  }
  if (phase === 'peak') return { maxLevel: config.peakLevel, pressure: config.peakPressure };
  return { maxLevel: config.quietLevel, pressure: 0 };
}

const guidanceOf = (phase: Phase, config: PacingConfig) =>
  ({ build: config.guidanceBuild, peak: config.guidancePeak, fade: config.guidanceFade, relax: config.guidanceRelax })[
    phase
  ];

/**
 * One turn of the director (the Left 4 Dead shape: build → peak → fade → relax → build). Pure: the node reads the
 * state, calls this and writes it back.
 *
 * 1. Intensity. With `tension` it is `max(intensity × decay, tension)`: it jumps up with a measured exchange and
 *    falls without one. Without it the beat clock stands in: the same formula with a tension implied by the phase.
 * 2. Phase. Unless `hold`, the phase either ends (see `exitReason`, judged on the intensity measured so far and the
 *    turns it has lasted) or this turn is one more turn of it. With `hold` the phase and its turn count stay; the
 *    intensity still follows a given tension.
 * 3. Outputs from the phase it is in now.
 */
export function step(
  previous: DirectorState | undefined,
  input: TurnInput,
  config: PacingConfig,
): { next: DirectorState; outputs: PacingOutputs } {
  const from = previous ?? START;
  const tension = input.tension === undefined ? undefined : clamp01(input.tension);
  const measured = tension === undefined ? from.intensity : Math.max(from.intensity * config.decay, tension);
  const source = tension === undefined ? 'beat clock' : `tension ${fmt(tension)}`;

  let phase = from.phase;
  let turns = from.turnsInPhase;
  let reason: string;
  if (input.hold) {
    reason = `holding ${phase} at turn ${turns} (hold is on)`;
  } else {
    const exit = exitReason(from.phase, from.turnsInPhase, measured, config);
    phase = exit ? NEXT[from.phase] : from.phase;
    turns = exit ? 1 : from.turnsInPhase + 1;
    reason = exit ? `${from.phase} → ${phase} ${exit}` : `${phase}, turn ${turns}`;
  }
  const intensity = input.hold
    ? measured
    : tension === undefined
      ? Math.max(from.intensity * config.decay, beat(phase, turns, config))
      : measured;
  const next: DirectorState = { phase, intensity, turnsInPhase: turns };
  const { maxLevel, pressure } = shape(phase, turns, config);
  return {
    next,
    outputs: {
      phase,
      intensity,
      maxLevel,
      pressure,
      turnsInPhase: turns,
      guidance: guidanceOf(phase, config),
      reason: `${reason}; intensity ${fmt(intensity)} (${source}); max level ${maxLevel}, pressure ${fmt(pressure)}`,
    },
  };
}

/**
 * The director's state after the given turns, oldest first, run from the very start with the current config. The
 * state itself is never stored: only each turn's input is (see the node), so a deleted or regenerated reply takes its
 * turn out of the replay and everything after it is recomputed.
 */
export function replay(history: readonly TurnInput[], config: PacingConfig): DirectorState | undefined {
  let state: DirectorState | undefined;
  for (const input of history) state = step(state, input, config).next;
  return state;
}
