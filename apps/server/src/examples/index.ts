import type { ExamplePack } from '../seed-examples.js';
import { freshTexture } from './fresh-texture.js';

/** Every example pack, in the order they are seeded. */
export const examplePacks: readonly ExamplePack[] = [freshTexture];
