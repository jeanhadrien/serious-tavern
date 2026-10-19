import { z } from 'zod';

const unit = (label: string) =>
  z.number().min(0, `${label} must be between 0 and 1`).max(1, `${label} must be between 0 and 1`);
const turns = (label: string) => z.number().int().min(1, `${label} must be at least 1 turn`);
const level = (label: string) =>
  z.number().int().min(1, `${label} goes from 1 to 5`).max(5, `${label} goes from 1 to 5`);

// What the preset tells the model in each phase. Plain text: the node does not render templates.
export const DEFAULT_GUIDANCE = {
  build:
    'Build: let the tension rise. Raise the stakes, press the characters with a complication, and keep the scene moving toward a confrontation.',
  peak: 'Peak: this is the climax. Stay in the moment and let events play out at full intensity; do not introduce new threats.',
  fade: 'Fade: the climax is over. Show its consequences, let the characters react, catch their breath and take stock; no new threats.',
  relax: 'Relax: let the scene breathe; no new threats, give room for character moments.',
} as const;

export const configSchema = z
  .object({
    decay: unit('Decay')
      .default(0.85)
      .describe(
        'With a Tension input: intensity = max(intensity × decay, tension), so it falls this much per turn without escalation. Also the fall in the beat clock',
      ),
    peakThreshold: unit('Peak threshold').default(0.7).describe('Build ends (→ peak) once intensity reaches this'),
    relaxThreshold: unit('Relax threshold').default(0.3).describe('Fade ends (→ relax) once intensity is below this'),
    maxBuildTurns: turns('Max build turns')
      .default(8)
      .describe('Build ends after this many turns even if intensity never reached the peak threshold'),
    peakTurns: turns('Peak turns').default(2).describe('Turns the peak lasts before it fades'),
    fadeTurns: turns('Fade turns')
      .default(3)
      .describe('Fade ends after this many turns even if intensity is still above the relax threshold'),
    relaxTurns: turns('Relax turns').default(3).describe('The refractory window: turns of quiet before the next build'),
    buildStartLevel: level('Build start level').default(2).describe('Max level on the first turn of a build'),
    buildMaxLevel: level('Build max level')
      .default(4)
      .describe('Max level on the last turn of a build; it ramps between the two with the turns in build'),
    peakLevel: level('Peak level').default(5).describe('Max level during the peak'),
    quietLevel: level('Quiet level').default(1).describe('Max level during fade and relax'),
    peakPressure: unit('Peak pressure')
      .default(0.1)
      .describe(
        'Pressure during the peak: low, so no new events pile on a climax. Build ramps 0 to 1, fade and relax are 0',
      ),
    guidanceBuild: z.string().default(DEFAULT_GUIDANCE.build).describe('Guidance output during build'),
    guidancePeak: z.string().default(DEFAULT_GUIDANCE.peak).describe('Guidance output during the peak'),
    guidanceFade: z.string().default(DEFAULT_GUIDANCE.fade).describe('Guidance output during fade'),
    guidanceRelax: z.string().default(DEFAULT_GUIDANCE.relax).describe('Guidance output during relax'),
  })
  .superRefine((config, issues) => {
    if (config.relaxThreshold > config.peakThreshold)
      issues.addIssue({
        code: 'custom',
        path: ['relaxThreshold'],
        message: 'Relax threshold can not be above the peak threshold',
      });
    if (config.buildStartLevel > config.buildMaxLevel)
      issues.addIssue({
        code: 'custom',
        path: ['buildMaxLevel'],
        message: 'Build max level must be at least the build start level',
      });
  });

export type PacingConfig = z.infer<typeof configSchema>;

export const defaultConfig: Record<string, unknown> = {
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
};
