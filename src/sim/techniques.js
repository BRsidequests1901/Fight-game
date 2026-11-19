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

export const isKick = (tech) => tech.limb === 'leadLeg' || tech.limb === 'rearLeg';

/**
 * Distance (body center to striking surface) a technique can reach, before stepping.
 * Includes a base allowance for the shoulder/hip sitting forward of the body
 * center in a bladed, leaning stance.
 */
export function techniqueReach(fighter, tech) {
  const kick = isKick(tech);
  const limb = kick ? fighter.body.legReach : fighter.body.armReach;
  return limb * tech.reachK + (tech.reachExtra + (kick ? 0.02 : 0.06)) * fighter.body.height;
}
