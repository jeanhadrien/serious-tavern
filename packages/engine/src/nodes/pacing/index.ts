import type { PortDef, StateKeyView } from '@st/shared';
import { describeValue } from '../../text.js';
import type { NodeDefinition } from '../../types.js';
import { numberInput } from '../number-input.js';
import { configSchema, defaultConfig, type PacingConfig } from './config.js';
import { replay, step, type TurnInput } from './machine.js';

/** The implicit key the director records each turn's inputs under (a node key, like the Trigger's `fires`). */
const PACING_STATE_KEY = 'beats';

const inputs: PortDef[] = [
  {
    name: 'tension',
    label: 'Tension',
    dataType: 'number',
    neverSkips: true,
    description:
      'How intense the latest exchange was, 0 to 1 (clamped; numeric text accepted), e.g. a rating written to story state after the reply. Not connected, or its source skipped: the beat clock runs this turn',
  },
  {
    name: 'hold',
    label: 'Hold',
    dataType: 'boolean',
    neverSkips: true,
    description:
      'True: the phase does not advance this turn (e.g. the user is mid-thread). Not connected counts as false',
  },
];

const outputs: PortDef[] = [
  { name: 'phase', label: 'Phase', dataType: 'text', description: 'build, peak, fade or relax' },
  { name: 'intensity', label: 'Intensity', dataType: 'number', description: 'The story intensity, 0 to 1' },
  {
    name: 'maxLevel',
    label: 'Max level',
    dataType: 'number',
    description: 'The biggest event level this phase allows, 1 to 5: wire it to a Trigger or Draw Max level',
  },
  {
    name: 'pressure',
    label: 'Pressure',
    dataType: 'number',
    description: 'How hard to push for an event, 0 to 1 (a stalled build pushes harder): wire it to a Trigger signal',
  },
  {
    name: 'turnsInPhase',
    label: 'Turns in phase',
    dataType: 'number',
    description: 'Turns the phase has lasted, this one included',
  },
  {
    name: 'guidance',
    label: 'Guidance',
    dataType: 'text',
    description: "The phase's directive for the prompt (configurable)",
  },
  {
    name: 'reason',
    label: 'Reason',
    dataType: 'text',
    description: 'The transition or the turn count, with the intensity, in words',
  },
];

/**
 * What the director was given in each earlier turn, oldest first. The collection comes newest first; items that lack
 * a usable `tension` or `hold` count as turns without one, so a hand-edited or older value never breaks a run.
 */
function readHistory(view: StateKeyView | undefined): TurnInput[] {
  if (!view || !Array.isArray(view.value)) return [];
  return view.value
    .map((item): TurnInput => {
      const { tension, hold } = (item ?? {}) as { tension?: unknown; hold?: unknown };
      return {
        ...(typeof tension === 'number' && Number.isFinite(tension) && { tension }),
        ...(hold === true && { hold }),
      };
    })
    .reverse();
}

/**
 * The Left 4 Dead director: build → peak → fade → relax → build, over an intensity that decays (see `step`). It
 * advances once per turn it runs. Each run records its own inputs as one item under the node's `beats` key and the
 * phase is replayed from those items, so deleting or regenerating a reply takes its turn out and the director goes
 * back with it, even from the middle of the chat.
 */
export const pacing: NodeDefinition = {
  type: 'pacing',
  label: 'Pacing',
  description:
    'A story director that cycles build, peak, fade and relax over a decaying intensity. Gives the biggest event level and a pressure for the Trigger, and a per-phase directive for the prompt. Feed Tension (a measured 0 to 1 intensity) or leave it unconnected to run a timed beat clock',
  category: 'Creativity',
  inputs,
  outputs,
  configSchema,
  defaultConfig,
  async execute(ctx) {
    const config = ctx.config as PacingConfig;
    // Both inputs are neverSkips: absent means not connected or its source was skipped.
    const input: TurnInput = {
      ...(Object.hasOwn(ctx.inputs, 'tension') && {
        tension: Math.min(1, Math.max(0, numberInput('Tension', ctx.inputs.tension))),
      }),
      ...(Object.hasOwn(ctx.inputs, 'hold') && { hold: holdInput(ctx.inputs.hold) }),
    };
    const previous = replay(readHistory(ctx.state.own(PACING_STATE_KEY)), config);
    const { next, outputs: result } = step(previous, input, config);
    ctx.writeState({
      target: { kind: 'node', key: PACING_STATE_KEY },
      op: 'add',
      item: { text: `${next.phase}, turn ${next.turnsInPhase}`, ...input },
    });
    return { ...result };
  },
};

function holdInput(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error(`Hold must be true or false, got ${describeValue(value)}`);
}
