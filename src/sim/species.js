// Species: biology that differs between kinds of creature. A style (behavior)
// points at a species; the species points at a body plan (skeleton + posing).
//
// regions:   effective struck mass (fraction of body mass) and contact time per region
// tol:       multipliers on damage tolerance after mass scaling (small brains tolerate
//            more g; hollow bird bones are fragile; big cats/bears are heavily muscled)
// boneMult:  bone strength multiplier (fracture thresholds also scale with mass^(2/3))
// fractures: per region, which bones can break, at what force (N, for a 75 kg human
//            equivalent), how likely the strike lines up with that bone, and the effect
// physMods:  overrides for movement/reaction (absolute values)

const HUMAN_FRACTURES = {
  head: [
    { id: 'nose', label: 'broken nose', thr: 1600, chance: 0.35, effect: 'nose' },
    { id: 'jaw', label: 'broken jaw', thr: 3800, chance: 0.25, effect: 'jaw' },
    { id: 'orbital', label: 'orbital fracture', thr: 4500, chance: 0.15, effect: 'orbital' },
    { id: 'skull', label: 'skull fracture', thr: 9000, chance: 1, effect: 'skull' },
  ],
  body: [{ id: 'ribs', label: 'broken ribs', thr: 4000, chance: 0.6, effect: 'ribs' }],
  legs: [
    { id: 'leg', label: 'broken leg', thr: 5500, chance: 0.5, effect: 'leg' },
    { id: 'knee', label: 'blown-out knee', thr: 3000, chance: 0.15, effect: 'leg', paths: ['sideKick', 'stomp', 'frontKick'] },
  ],
  arm: [{ id: 'arm', label: 'broken forearm', thr: 3200, chance: 0.6, effect: 'arm' }],
};

const QUAD_FRACTURES = {
  head: [
    { id: 'jaw', label: 'broken jaw', thr: 2600, chance: 0.3, effect: 'jaw' },
    { id: 'skull', label: 'skull fracture', thr: 7000, chance: 1, effect: 'skull' },
  ],
  body: [{ id: 'ribs', label: 'broken ribs', thr: 3300, chance: 0.6, effect: 'ribs' }],
  legs: [{ id: 'leg', label: 'broken leg', thr: 5000, chance: 0.6, effect: 'leg' }],
  arm: [],
};

const BIRD_FRACTURES = {
  head: [{ id: 'skull', label: 'skull fracture', thr: 6000, chance: 1, effect: 'skull' }],
  body: [
    { id: 'wing', label: 'broken wing', thr: 2500, chance: 0.4, effect: 'wing' },
    { id: 'keel', label: 'broken keel', thr: 3300, chance: 0.4, effect: 'ribs' },
  ],
  legs: [{ id: 'leg', label: 'broken leg', thr: 4000, chance: 0.6, effect: 'leg' }],
  arm: [],
};

export const SPECIES = {
  human: {
    name: 'Human',
    plan: 'human',
    bloodPerKg: 0.07,
    boneMult: 1,
    tol: { head: 1, body: 1, legs: 1 },
    regions: {
      head: { massFrac: 0.081, contactTime: 0.012 },
      body: { massFrac: 0.25, contactTime: 0.02 },
      legs: { massFrac: 0.1, contactTime: 0.016 },
    },
    fractures: HUMAN_FRACTURES,
    canBlock: true,
    humanoid: true,
    legsToStand: 1, // number of broken legs that make standing impossible
    sizeRange: { height: [140, 215], weight: [45, 150], heightLabel: 'Height cm' },
    physMods: {},
  },
  goose: {
    name: 'Goose',
    plan: 'bird',
    bloodPerKg: 0.08,
    boneMult: 0.5,
    tol: { head: 1.8, body: 0.6, legs: 0.7 },
    regions: {
      head: { massFrac: 0.04, contactTime: 0.008 },
      body: { massFrac: 0.75, contactTime: 0.015 },
      legs: { massFrac: 0.05, contactTime: 0.01 },
    },
    fractures: BIRD_FRACTURES,
    canBlock: false,
    legsToStand: 1,
    sizeRange: { height: [55, 100], weight: [2.5, 7], heightLabel: 'Standing height cm' },
    physMods: { moveSpeed: 3.4, accel: 14, reaction: 0.18 },
  },
  dog: {
    name: 'Dog',
    plan: 'quadruped',
    bloodPerKg: 0.085,
    boneMult: 1,
    tol: { head: 1.3, body: 1.1, legs: 1 },
    regions: {
      head: { massFrac: 0.09, contactTime: 0.012 },
      body: { massFrac: 0.45, contactTime: 0.02 },
      legs: { massFrac: 0.06, contactTime: 0.012 },
    },
    fractures: QUAD_FRACTURES,
    canBlock: false,
    legsToStand: 2,
    sizeRange: { height: [35, 85], weight: [12, 80], heightLabel: 'Shoulder height cm' },
    physMods: { moveSpeed: 6, accel: 16, reaction: 0.17 },
  },
  tiger: {
    name: 'Tiger',
    plan: 'quadruped',
    bloodPerKg: 0.07,
    boneMult: 1.3,
    tol: { head: 1.8, body: 1.6, legs: 1.4 },
    regions: {
      head: { massFrac: 0.07, contactTime: 0.014 },
      body: { massFrac: 0.5, contactTime: 0.025 },
      legs: { massFrac: 0.08, contactTime: 0.016 },
    },
    fractures: QUAD_FRACTURES,
    canBlock: false,
    legsToStand: 2,
    sizeRange: { height: [80, 115], weight: [100, 300], heightLabel: 'Shoulder height cm' },
    physMods: { moveSpeed: 7, accel: 14, reaction: 0.13 },
  },
  bear: {
    name: 'Grizzly bear',
    plan: 'quadruped',
    bloodPerKg: 0.07,
    boneMult: 1.4,
    tol: { head: 2.2, body: 2.0, legs: 1.6 },
    regions: {
      head: { massFrac: 0.06, contactTime: 0.016 },
      body: { massFrac: 0.55, contactTime: 0.03 },
      legs: { massFrac: 0.08, contactTime: 0.02 },
    },
    fractures: QUAD_FRACTURES,
    canBlock: false,
    legsToStand: 2,
    sizeRange: { height: [85, 130], weight: [150, 450], heightLabel: 'Shoulder height cm' },
    physMods: { moveSpeed: 6, accel: 10, reaction: 0.2 },
  },
};

export function getSpecies(id) {
  const s = SPECIES[id || 'human'];
  if (!s) throw new Error(`Unknown species: ${id}`);
  return s;
}
