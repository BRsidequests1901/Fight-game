// Seeded, deterministic pseudo-random number generator (mulberry32).
// Every random decision in the simulation goes through one of these so that
// the same config + seed always reproduces the exact same fight.
export function createRng(seed = 1) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** items: array of [value, weight] */
    weighted(items) {
      let total = 0;
      for (const [, w] of items) total += Math.max(0, w);
      if (total <= 0) return items.length ? items[0][0] : undefined;
      let r = next() * total;
      for (const [v, w] of items) {
        r -= Math.max(0, w);
        if (r <= 0) return v;
      }
      return items[items.length - 1][0];
    },
    getState: () => s,
    setState: (v) => { s = v >>> 0; },
  };
}
