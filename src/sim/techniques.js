// Strike definitions. All numbers are for an average-trained adult and are
// scaled at runtime by the fighter's physiology.
//
// limb:      which limb delivers it (leadHand, rearHand, leadLeg, rearLeg)
// path:      motion shape used for animation and defense interactions
// windup/active/recovery: seconds (windup scaled by telegraph, all by speed)
// speed:     contact speed of the striking surface, m/s
// massFrac:  fraction of body mass effectively behind the strike
// reachK:    fraction of limb length used; reachExtra: extra reach as a fraction of height
//            (shoulder/hip rotation, lean); step: lunge distance in meters
// targets:   relative likelihood of aiming at each region
// headSeverity: rotational-acceleration multiplier for head shots (hooks > straights)
// knockback: multiplier for momentum that pushes the target / breaks balance
// twist:     torso rotation used in animation (fraction of stance twist unwound)
// leanBack:  torso lean (rad) at full extension, used by kicks
export const TECHNIQUES = {
  jab: {
    name: 'Jab', limb: 'leadHand', path: 'straight',
    windup: 0.05, active: 0.11, recovery: 0.15,
    speed: 7.5, massFrac: 0.035, reachK: 1.0, reachExtra: 0.06, minRange: 0.35, step: 0.12,
    targets: { head: 0.8, body: 0.2 }, headSeverity: 1.0, knockback: 0.8, twist: 0.35,
  },
  cross: {
    name: 'Cross', limb: 'rearHand', path: 'straight',
    windup: 0.09, active: 0.14, recovery: 0.22,
    speed: 9, massFrac: 0.06, reachK: 1.0, reachExtra: 0.11, minRange: 0.35, step: 0.08,
    targets: { head: 0.75, body: 0.25 }, headSeverity: 1.1, knockback: 1.0, twist: 1.6,
  },
  leadHook: {
    name: 'Lead hook', limb: 'leadHand', path: 'hook',
    windup: 0.1, active: 0.14, recovery: 0.24,
    speed: 9.5, massFrac: 0.06, reachK: 0.72, reachExtra: 0.05, minRange: 0.25, step: 0.05,
    targets: { head: 0.7, body: 0.3 }, headSeverity: 1.45, knockback: 0.9, twist: 2.0, liver: true,
  },
  rearHook: {
    name: 'Rear hook', limb: 'rearHand', path: 'hook',
    windup: 0.13, active: 0.15, recovery: 0.26,
    speed: 9.5, massFrac: 0.065, reachK: 0.72, reachExtra: 0.07, minRange: 0.25, step: 0.05,
    targets: { head: 0.75, body: 0.25 }, headSeverity: 1.45, knockback: 0.9, twist: 1.8,
  },
  uppercut: {
    name: 'Uppercut', limb: 'rearHand', path: 'uppercut',
    windup: 0.12, active: 0.13, recovery: 0.24,
    speed: 8, massFrac: 0.055, reachK: 0.68, reachExtra: 0.05, minRange: 0.2, step: 0.05,
    targets: { head: 0.8, body: 0.2 }, headSeverity: 1.35, knockback: 0.8, twist: 1.3,
  },
  haymaker: {
    name: 'Haymaker', limb: 'rearHand', path: 'hook',
    windup: 0.24, active: 0.17, recovery: 0.32,
    speed: 10, massFrac: 0.055, reachK: 0.82, reachExtra: 0.06, minRange: 0.3, step: 0.12,
    targets: { head: 0.9, body: 0.1 }, headSeverity: 1.4, knockback: 1.0, twist: 1.9,
  },
  chainPunch: {
    name: 'Chain punch', limb: 'leadHand', path: 'straight',
    windup: 0.03, active: 0.08, recovery: 0.08,
    speed: 6.5, massFrac: 0.03, reachK: 0.95, reachExtra: 0.03, minRange: 0.25, step: 0.1,
    targets: { head: 0.8, body: 0.2 }, headSeverity: 0.95, knockback: 0.7, twist: 0.1, alternate: true,
  },
  reversePunch: {
    name: 'Reverse punch', limb: 'rearHand', path: 'straight',
    windup: 0.11, active: 0.15, recovery: 0.24,
    speed: 9, massFrac: 0.065, reachK: 1.0, reachExtra: 0.12, minRange: 0.4, step: 0.3,
    targets: { head: 0.5, body: 0.5 }, headSeverity: 1.05, knockback: 1.1, twist: 1.7,
  },
  palmStrike: {
    name: 'Palm strike', limb: 'rearHand', path: 'straight',
    windup: 0.1, active: 0.14, recovery: 0.22,
    speed: 8, massFrac: 0.065, reachK: 0.97, reachExtra: 0.1, minRange: 0.3, step: 0.15,
    targets: { head: 0.55, body: 0.45 }, headSeverity: 0.95, knockback: 1.35, twist: 1.5,
  },
  tigerClaw: {
    name: 'Tiger claw', limb: 'rearHand', path: 'claw',
    windup: 0.1, active: 0.14, recovery: 0.22,
    speed: 8.5, massFrac: 0.05, reachK: 0.92, reachExtra: 0.08, minRange: 0.3, step: 0.2,
    targets: { head: 0.65, body: 0.35 }, headSeverity: 1.0, knockback: 0.8, twist: 1.5, cut: true,
  },
  leadClaw: {
    name: 'Lead tiger claw', limb: 'leadHand', path: 'claw',
    windup: 0.07, active: 0.12, recovery: 0.18,
    speed: 8, massFrac: 0.04, reachK: 0.95, reachExtra: 0.06, minRange: 0.3, step: 0.18,
    targets: { head: 0.7, body: 0.3 }, headSeverity: 0.95, knockback: 0.7, twist: 0.4, cut: true,
  },
  rearElbow: {
    name: 'Elbow', limb: 'rearHand', path: 'elbow',
    windup: 0.09, active: 0.11, recovery: 0.2,
    speed: 7.5, massFrac: 0.06, reachK: 0.42, reachExtra: 0.1, minRange: 0.15, step: 0.08,
    targets: { head: 0.9, body: 0.1 }, headSeverity: 1.4, knockback: 0.8, twist: 1.6, cut: true,
  },
  knee: {
    name: 'Knee', limb: 'rearLeg', path: 'knee',
    windup: 0.12, active: 0.14, recovery: 0.25,
    speed: 7, massFrac: 0.1, reachK: 0.5, reachExtra: 0.05, minRange: 0.15, step: 0.12,
    targets: { body: 0.8, head: 0.2 }, headSeverity: 1.2, knockback: 1.1, twist: 0.6, leanBack: 0.15, liver: true,
  },
  roundKick: {
    name: 'Roundhouse kick', limb: 'rearLeg', path: 'roundKick',
    windup: 0.15, active: 0.2, recovery: 0.34,
    speed: 12, massFrac: 0.1, reachK: 1.0, reachExtra: 0.12, minRange: 0.45, step: 0.1,
    targets: { legs: 0.35, body: 0.4, head: 0.25 }, headSeverity: 1.3, knockback: 1.0, twist: 1.6,
    leanBack: 0.35, liver: true, cost: 1.2,
  },
  leadRoundKick: {
    name: 'Lead roundhouse', limb: 'leadLeg', path: 'roundKick',
    windup: 0.1, active: 0.16, recovery: 0.26,
    speed: 11, massFrac: 0.07, reachK: 1.0, reachExtra: 0.1, minRange: 0.45, step: 0.1,
    targets: { body: 0.55, head: 0.35, legs: 0.1 }, headSeverity: 1.25, knockback: 0.9, twist: -0.6,
    leanBack: 0.35, cost: 1.1,
  },
  frontKick: {
    name: 'Front kick', limb: 'rearLeg', path: 'frontKick',
    windup: 0.14, active: 0.16, recovery: 0.28,
    speed: 10, massFrac: 0.09, reachK: 1.02, reachExtra: 0.12, minRange: 0.5, step: 0.12,
    targets: { body: 0.85, head: 0.15 }, headSeverity: 1.0, knockback: 1.6, twist: 0.8, leanBack: 0.2, cost: 1.1,
  },
  teep: {
    name: 'Teep (push kick)', limb: 'leadLeg', path: 'frontKick',
    windup: 0.11, active: 0.15, recovery: 0.24,
    speed: 8.5, massFrac: 0.1, reachK: 1.05, reachExtra: 0.1, minRange: 0.5, step: 0.05,
    targets: { body: 0.9, head: 0.1 }, headSeverity: 0.9, knockback: 2.0, twist: 0, leanBack: 0.25, cost: 1.0,
  },
  sideKick: {
    name: 'Side kick', limb: 'leadLeg', path: 'sideKick',
    windup: 0.16, active: 0.17, recovery: 0.3,
    speed: 10, massFrac: 0.13, reachK: 1.05, reachExtra: 0.14, minRange: 0.55, step: 0.15,
    targets: { body: 0.75, head: 0.15, legs: 0.1 }, headSeverity: 1.0, knockback: 2.0, twist: -0.9,
    leanBack: 0.5, cost: 1.2,
  },
};

// ---------------------------------------------------------------- ground & street
Object.assign(TECHNIQUES, {
  stomp: {
    name: 'Stomp', limb: 'rearLeg', path: 'stomp',
    windup: 0.15, active: 0.12, recovery: 0.25,
    speed: 5, massFrac: 0.25, reachK: 0.55, reachExtra: 0, minRange: 0.1, step: 0.1,
    targets: { head: 0.45, body: 0.3, legs: 0.25 }, headSeverity: 1.2, knockback: 0.3, twist: 0, minY: 0, maxY: 0.22,
  },
  soccerKick: {
    name: 'Soccer kick', limb: 'rearLeg', path: 'soccer',
    windup: 0.18, active: 0.14, recovery: 0.3,
    speed: 11, massFrac: 0.09, reachK: 0.9, reachExtra: 0.05, minRange: 0.4, step: 0.1,
    targets: { head: 0.5, body: 0.5 }, headSeverity: 1.3, knockback: 1.2, twist: 0.8, minY: 0, maxY: 0.35,
  },
  groundPunch: {
    name: 'Ground punch', limb: 'leadHand', path: 'groundStrike', alternate: true, requires: 'top',
    windup: 0.07, active: 0.1, recovery: 0.14,
    speed: 7, massFrac: 0.045, reachK: 1, reachExtra: 0, minRange: 0, step: 0,
    targets: { head: 0.75, body: 0.25 }, headSeverity: 1.1, knockback: 0.4, twist: 0.3, minY: 0, maxY: 0.6,
  },
  groundElbow: {
    name: 'Ground elbow', limb: 'rearHand', path: 'groundStrike', requires: 'top',
    windup: 0.12, active: 0.1, recovery: 0.2,
    speed: 7, massFrac: 0.06, reachK: 0.6, reachExtra: 0, minRange: 0, step: 0,
    targets: { head: 0.85, body: 0.15 }, headSeverity: 1.4, knockback: 0.4, twist: 0.5, cut: true, minY: 0, maxY: 0.6,
  },
  upPunch: {
    name: 'Punch from bottom', limb: 'leadHand', path: 'straight', alternate: true, requires: 'bottom',
    windup: 0.08, active: 0.1, recovery: 0.16,
    speed: 4.5, massFrac: 0.02, reachK: 1, reachExtra: 0, minRange: 0, step: 0,
    targets: { head: 0.7, body: 0.3 }, headSeverity: 0.9, knockback: 0.2, twist: 0, minY: 0, maxY: 1.2,
  },
  // ---------------------------------------------------------------- grappling entries
  doubleLeg: {
    name: 'Double-leg takedown', limb: 'body', path: 'shoot', kind: 'grapple', grapple: 'takedown', humanoidOnly: true,
    windup: 0.14, active: 0.22, recovery: 0.45,
    speed: 4, massFrac: 0, reachSeg: 'arm', reachK: 0.7, reachExtra: 0, minRange: 0.3, step: 0.7,
    targets: { legs: 1 }, headSeverity: 0, knockback: 0, twist: 0, minY: 0.15, maxY: 0.9, cost: 0, grappleCost: 1200,
  },
  clinchEntry: {
    name: 'Clinch', limb: 'body', path: 'clinch', kind: 'grapple', grapple: 'clinch', humanoidOnly: true,
    windup: 0.06, active: 0.15, recovery: 0.25,
    speed: 3, massFrac: 0, reachSeg: 'arm', reachK: 0.85, reachExtra: 0, minRange: 0.2, step: 0.3,
    targets: { head: 1 }, headSeverity: 0, knockback: 0, twist: 0, minY: 0.6, maxY: 1.1, cost: 0, grappleCost: 300,
  },
  hipThrow: {
    name: 'Hip throw', limb: 'body', path: 'throw', kind: 'grapple', grapple: 'throw', requires: 'clinch',
    windup: 0.2, active: 0.28, recovery: 0.35,
    speed: 3, massFrac: 0, reachSeg: 'arm', reachK: 1, reachExtra: 0, minRange: 0, step: 0.05,
    targets: { body: 1 }, headSeverity: 0, knockback: 0, twist: 0, minY: 0, maxY: 2, cost: 0, grappleCost: 1000,
  },
  guardPull: {
    name: 'Guard pull', limb: 'body', path: 'guardPull', kind: 'grapple', grapple: 'guardPull', requires: 'clinch',
    windup: 0.1, active: 0.25, recovery: 0.2,
    speed: 2, massFrac: 0, reachSeg: 'arm', reachK: 1, reachExtra: 0, minRange: 0, step: 0,
    targets: { body: 1 }, headSeverity: 0, knockback: 0, twist: 0, minY: 0, maxY: 2, cost: 0, grappleCost: 400,
  },
  // ---------------------------------------------------------------- animals
  gooseBite: {
    name: 'Bite', limb: 'beak', path: 'bite', kind: 'bite', maul: true,
    windup: 0.08, active: 0.1, recovery: 0.18,
    speed: 3, massFrac: 0.02, reachSeg: 'beak', reachK: 1, reachExtra: 0, minRange: 0.05, step: 0.15,
    targets: { legs: 0.6, body: 0.35, head: 0.05 }, biteForce: 60, cutRate: 0.003,
    headSeverity: 0.5, knockback: 0.1, twist: 0, minY: 0, maxY: 1.6,
  },
  gooseWing: {
    name: 'Wing strike', limb: 'wing', path: 'wing',
    windup: 0.12, active: 0.1, recovery: 0.2,
    speed: 12, massFrac: 0.06, reachSeg: 'wing', reachK: 1, reachExtra: 0, minRange: 0.05, step: 0.25,
    targets: { legs: 0.6, body: 0.3, head: 0.1 }, headSeverity: 0.8, knockback: 0.4, twist: 0, minY: 0, maxY: 2.0,
  },
  gooseLeap: {
    name: 'Flying attack', limb: 'wing', path: 'leap',
    windup: 0.18, active: 0.2, recovery: 0.35,
    speed: 10, massFrac: 0.1, reachSeg: 'wing', reachK: 1.2, reachExtra: 0, minRange: 0.3, step: 0.6,
    targets: { head: 0.7, body: 0.3 }, headSeverity: 0.9, knockback: 0.5, twist: 0, minY: 1.0, maxY: 2.6, cost: 2,
  },
  dogBite: {
    name: 'Bite', limb: 'jaw', path: 'bite', kind: 'bite', maul: true,
    windup: 0.1, active: 0.1, recovery: 0.25,
    speed: 4, massFrac: 0.05, reachSeg: 'jaw', reachK: 1, reachExtra: 0, minRange: 0.1, step: 0.4,
    targets: { legs: 0.5, body: 0.35, head: 0.15 }, biteForce: 1100, latch: 0.55, cutRate: 0.06,
    headSeverity: 0.6, knockback: 0.3, twist: 0, minY: 0, maxY: 1.7,
  },
  dogLunge: {
    name: 'Lunge', limb: 'body', path: 'lunge',
    windup: 0.15, active: 0.18, recovery: 0.4,
    speed: 6, massFrac: 0.45, reachSeg: 'body', reachK: 1, reachExtra: 0, minRange: 0.7, step: 1.2,
    targets: { body: 1 }, headSeverity: 1, knockback: 1.6, twist: 0, minY: 0.3, maxY: 1.6, cost: 1.5,
  },
  clawSwipe: {
    name: 'Claw swipe', limb: 'leadPaw', path: 'swipe', kind: 'claw', maul: true,
    windup: 0.12, active: 0.12, recovery: 0.25,
    speed: 9, massFrac: 0.08, reachSeg: 'paw', reachK: 1, reachExtra: 0, minRange: 0.3, step: 0.3,
    targets: { head: 0.55, body: 0.35, legs: 0.1 }, headSeverity: 1.4, knockback: 1.2, twist: 0, cutRate: 0.25, minY: 0, maxY: 2.1,
  },
  tigerBite: {
    name: 'Bite', limb: 'jaw', path: 'bite', kind: 'bite', maul: true,
    windup: 0.12, active: 0.12, recovery: 0.3,
    speed: 4.5, massFrac: 0.06, reachSeg: 'jaw', reachK: 1, reachExtra: 0, minRange: 0.1, step: 0.4,
    targets: { head: 0.6, body: 0.3, legs: 0.1 }, biteForce: 4500, latch: 0.3, cutRate: 0.5, lethalNeck: true,
    headSeverity: 1, knockback: 0.5, twist: 0, minY: 0, maxY: 2.0,
  },
  pounce: {
    name: 'Pounce', limb: 'body', path: 'pounce',
    windup: 0.25, active: 0.25, recovery: 0.5,
    speed: 6.5, massFrac: 0.5, reachSeg: 'body', reachK: 1, reachExtra: 0, minRange: 1.3, step: 2.6,
    targets: { body: 0.6, head: 0.4 }, headSeverity: 1, knockback: 1.9, twist: 0, pinOnDown: true, minY: 0.3, maxY: 2.2, cost: 2,
  },
  bearSwipe: {
    name: 'Paw swipe', limb: 'leadPaw', path: 'swipe', kind: 'claw', maul: true,
    windup: 0.16, active: 0.14, recovery: 0.3,
    speed: 8, massFrac: 0.1, reachSeg: 'paw', reachK: 1, reachExtra: 0, minRange: 0.3, step: 0.3,
    targets: { head: 0.55, body: 0.35, legs: 0.1 }, headSeverity: 1.5, knockback: 1.5, twist: 0, cutRate: 0.2, minY: 0, maxY: 2.2,
  },
  bearBite: {
    name: 'Bite', limb: 'jaw', path: 'bite', kind: 'bite', maul: true,
    windup: 0.14, active: 0.12, recovery: 0.3,
    speed: 4, massFrac: 0.06, reachSeg: 'jaw', reachK: 1, reachExtra: 0, minRange: 0.1, step: 0.35,
    targets: { head: 0.5, body: 0.3, legs: 0.2 }, biteForce: 5000, latch: 0.25, cutRate: 0.4, lethalNeck: true,
    headSeverity: 1, knockback: 0.6, twist: 0, minY: 0, maxY: 2.0,
  },
  bearCharge: {
    name: 'Charge', limb: 'body', path: 'lunge',
    windup: 0.2, active: 0.25, recovery: 0.5,
    speed: 6, massFrac: 0.6, reachSeg: 'body', reachK: 1, reachExtra: 0, minRange: 1.0, step: 1.8,
    targets: { body: 1 }, headSeverity: 1, knockback: 1.8, twist: 0, pinOnDown: true, minY: 0.3, maxY: 2.0, cost: 2,
  },
});

export const isKick = (tech) => tech.limb === 'leadLeg' || tech.limb === 'rearLeg';
export const isHand = (tech) => tech.limb === 'leadHand' || tech.limb === 'rearHand';

/** Broad category of a technique (drives defense, gloves, costs). */
export function techKind(tech) {
  if (tech.kind) return tech.kind;
  if (isHand(tech)) return 'punch';
  if (isKick(tech)) return 'kick';
  return 'strike';
}

/** Vertical band (meters, world y) the technique can hit, for this attacker. */
export function heightBand(fighter, tech) {
  const H = fighter.body.height;
  const kind = techKind(tech);
  const lo = tech.minY ?? (kind === 'punch' ? 0.42 : 0.12);
  const hi = tech.maxY ?? (kind === 'punch' ? 1.05 : 1.0);
  return [lo * H, hi * H];
}

/**
 * Distance (body center to striking surface) a technique can reach, before stepping.
 * Humans get a base allowance for the shoulder/hip sitting forward of the body
 * center in a bladed, leaning stance.
 */
export function techniqueReach(fighter, tech) {
  const seg = tech.reachSeg || (isKick(tech) ? 'leg' : isHand(tech) ? 'arm' : tech.limb === 'leadPaw' ? 'paw' : tech.limb);
  const base = fighter.body.reach[seg] ?? fighter.body.radius;
  const human = fighter.body.plan === 'human' && (isKick(tech) || isHand(tech));
  return base * tech.reachK + (tech.reachExtra + (human ? (isKick(tech) ? 0.02 : 0.06) : 0)) * fighter.body.height;
}
