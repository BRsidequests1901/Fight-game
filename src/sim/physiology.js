// Biology & biomechanics: turns RPG-style attributes into physical quantities,
// and computes the physics of a strike landing on a body region.
//
// Sources for the constants (approximate, see README "Realism notes"):
//  - Segment masses / lengths: Winter, "Biomechanics and Motor Control of Human Movement".
//  - Punch effective mass 2-6 kg, peak forces 2-5 kN: Walilko et al. 2005; Smith et al. 2000.
//  - Head linear acceleration from punches/kicks 30-150 g: Walilko 2005; Viano 2005.
//  - Simple visual reaction ~0.2-0.3 s; trained fighters faster.
import { clamp, G } from './math.js';

export const ATTRIBUTES = [
  { key: 'strength', label: 'Strength', hint: 'Muscle force: mass behind strikes, acceleration, neck/stability' },
  { key: 'dexterity', label: 'Dexterity', hint: 'Limb speed, reaction time, footwork, evasion' },
  { key: 'endurance', label: 'Endurance', hint: 'Anaerobic reserve and aerobic recovery (stamina)' },
  { key: 'durability', label: 'Durability', hint: 'Chin, body and leg damage tolerance' },
  { key: 'technique', label: 'Technique', hint: 'Kinetic-chain efficiency, accuracy, defense, less telegraphing' },
];
// Scale like tabletop RPGs: 10 = average untrained adult, 14-16 trained athlete, 18-20 elite.
export const ATTR_MIN = 1;
export const ATTR_MAX = 20;

/** Body regions that can be struck. massFrac = effective mass of the struck part. */
export const REGIONS = {
  head: { label: 'head', massFrac: 0.081, contactTime: 0.012, heightFrac: 0.92 },
  body: { label: 'body', massFrac: 0.25, contactTime: 0.02, heightFrac: 0.66 },
  legs: { label: 'legs', massFrac: 0.1, contactTime: 0.016, heightFrac: 0.4 },
};

export function derivePhysiology(attrs, body) {
  const a = {};
  for (const { key } of ATTRIBUTES) a[key] = clamp(Number(attrs[key] ?? 10), ATTR_MIN, ATTR_MAX);
  const n = (k) => (a[k] - 10) / 10; // -0.9 .. +1.0
  const massRatio = body.mass / 75;
  return {
    /** relative muscular force */
    force: 1 + 0.4 * n('strength'),
    /** relative limb/strike speed */
    speed: 1 + 0.18 * n('dexterity') + 0.05 * n('strength'),
    /** seconds from an opponent starting a strike to being able to respond */
    reaction: clamp(0.27 - 0.05 * n('dexterity') - 0.04 * n('technique'), 0.15, 0.4),
    /** chance a well-aimed, in-range strike actually connects */
    accuracy: clamp(0.5 + 0.02 * a.technique + 0.008 * a.dexterity, 0.4, 0.95),
    /** fraction of body mass effectively transferred through the kinetic chain */
    transfer: clamp(0.62 + 0.02 * a.technique, 0.6, 1.0),
    /** probability of attempting a timely defense when a threat is perceived */
    defense: clamp(0.15 + 0.035 * a.technique + 0.01 * a.dexterity, 0.1, 0.92),
    /** windup-time multiplier: untrained fighters telegraph */
    telegraph: clamp(1.3 - 0.025 * a.technique, 0.8, 1.3),
    /** anaerobic work capacity in joules (metabolic) */
    staminaCap: 22000 * (1 + 0.5 * n('endurance')) * massRatio,
    /** sustainable aerobic metabolic power in watts */
    aerobic: 800 * (1 + 0.4 * n('endurance')) * massRatio,
    /** head acceleration (g, rotation-weighted) at which a knockout is a coin flip */
    headTol: 125 * (1 + 0.25 * n('durability') + 0.08 * n('strength')),
    bodyTol: (1 + 0.35 * n('durability')) * Math.sqrt(massRatio),
    legTol: (1 + 0.3 * n('durability') + 0.1 * n('strength')) * Math.sqrt(massRatio),
    /** max footwork speed in fighting stance, m/s */
    moveSpeed: 2.2 * (1 + 0.15 * n('dexterity')),
    /** max horizontal acceleration, m/s^2 */
    accel: (7 * (1 + 0.4 * n('strength'))) / Math.cbrt(massRatio),
  };
}

/**
 * One-dimensional collision of an effective striking mass with a body region,
 * modelled as a half-sine force pulse.
 */
export function strikeImpact({ strikerMass, velocity, targetMass, contactTime, restitution = 0.2 }) {
  const reduced = (strikerMass * targetMass) / (strikerMass + targetMass);
  const impulse = (1 + restitution) * reduced * velocity; // N*s
  const peakForce = (Math.PI / 2) * (impulse / contactTime); // N
  const peakAccel = peakForce / targetMass; // m/s^2 of the struck segment
  return { impulse, peakForce, accelG: peakAccel / G, reducedMass: reduced };
}
