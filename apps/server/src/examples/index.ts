import type { ExamplePack } from '../seed-examples.js';
import { freshTexture } from './fresh-texture.js';
import { rollingSummaries } from './rolling-summaries.js';
import { scenarist } from './scenarist.js';

/** Every example pack, in the order they are seeded. */
export const examplePacks: readonly ExamplePack[] = [freshTexture, rollingSummaries, scenarist];
