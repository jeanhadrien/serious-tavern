// Deterministic random numbers for nodes. Pure 32-bit integer math, so it would give the same values in a
// browser. The algorithm is pinned by a golden test: changing it breaks reproducing old runs from their seed.
import { hashSeed } from '@st/shared';

/** Canonical sfc32 seeded from `seed`: each call returns the next value in [0, 1). */
export function createRandom(seed: string): () => number {
  let [a, b, c, d] = hashSeed(seed);
  return () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}
