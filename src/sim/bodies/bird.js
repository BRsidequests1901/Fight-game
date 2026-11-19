// Bird body plan (geese, swans): S-curved neck, beak, folding wings with the
// bony carpal "knob" geese strike with, short legs with backward-bending heels.
import { TECHNIQUES } from '../techniques.js';
import { v3, add, lerp3, clamp, solveTwoBone } from '../math.js';
import { toWorld, rollToSide, blendPose, attackCurve, isLying } from './common.js';

export const JOINTS = [
  'beak', 'head', 'neckTop', 'neckMid', 'chest', 'tail',
  'lShoulder', 'lWrist', 'lTip', 'rShoulder', 'rWrist', 'rTip',
  'lHip', 'lAnkle', 'lFoot', 'lToe', 'rHip', 'rAnkle', 'rFoot', 'rToe',
];

export const BONES = [
  ['chest', 'tail', 0.26], ['chest', 'neckMid', 0.07], ['neckMid', 'neckTop', 0.06], ['neckTop', 'head', 0.06],
  ['head', 'beak', 0.035],
  ['lShoulder', 'lWrist', 0.05], ['lWrist', 'lTip', 0.035], ['rShoulder', 'rWrist', 0.05], ['rWrist', 'rTip', 0.035],
  ['lHip', 'lAnkle', 0.035], ['lAnkle', 'lFoot', 0.025], ['lFoot', 'lToe', 0.03],
  ['rHip', 'rAnkle', 0.035], ['rAnkle', 'rFoot', 0.025], ['rFoot', 'rToe', 0.03],
];

/** sizeCm = standing height with the neck up. */
export function buildBird(sizeCm, massKg) {
  const H = sizeCm / 100;
  return {
    plan: 'bird',
    height: H,
    mass: massKg,
    headRadius: 0.05 * H,
    radius: 0.24 * H,
    width: 0.24 * H,
    reach: { beak: 0.62 * H, wing: 0.5 * H },
    surface: { head: 0.04 * H, body: 0.14 * H, legs: 0.03 * H },
  };
}

function birdLocal(f, time, rest) {
  const H = f.body.height;
  const a = rest ? null : f.action;
  const hiss = !rest && f.state !== 'out' && f.state !== 'down';
  let lift = 0;
  const c = Math.cos(f.facing);
  const s = Math.sin(f.facing);
  const va = rest ? 0 : f.vel.x * c + f.vel.z * s;
  const sp = rest ? 0 : Math.hypot(f.vel.x, f.vel.z);
  const g = f.gaitPhase * 1.6;
  const roll = sp > 0.05 ? Math.sin(g) * 0.025 * H : 0;

  const chest = v3(0.22 * H, 0.4 * H, roll);
  const tail = v3(-0.36 * H, 0.42 * H, roll);
  // neck: upright at rest, low and forward when hissing
  let neckMid = hiss ? add(chest, v3(0.15 * H, 0.08 * H, 0)) : add(chest, v3(0.07 * H, 0.2 * H, 0));
  let neckTop = hiss ? add(neckMid, v3(0.17 * H, 0.02 * H, 0)) : add(neckMid, v3(0.01 * H, 0.2 * H, 0));
  let head = add(neckTop, v3(0.06 * H, hiss ? 0.01 * H : 0.06 * H, 0));
  let spread = hiss ? 0.4 : 0;
  let wristOverride = null;

  if (!rest && f.state === 'attack' && a) {
    const tech = TECHNIQUES[a.techId];
    const target = v3(clamp(a.aimDist - 0.04, 0.1 * H, 2 * H), a.aimHeight, 0);
    const needLift = Math.max(0, target.y - 0.85 * H);
    if (tech.limb === 'beak') {
      const { ext } = attackCurve(a, v3(0, 0, 0), v3(0, 0, 0), v3(1, 0, 0), v3(0, 0, 0));
      lift = needLift * ext;
      const t = add(target, v3(-0.1 * H, -lift, 0));
      head = lerp3(head, t, ext);
      neckTop = lerp3(neckTop, lerp3(chest, t, 0.75), ext);
      neckMid = lerp3(neckMid, add(lerp3(chest, t, 0.4), v3(0, 0.05 * H, 0)), ext);
      spread = Math.max(spread, ext * 0.6);
    } else if (tech.limb === 'wing') {
      const { p, ext, wind } = attackCurve(a, v3(0, 0.45 * H, 0.12 * H), v3(0.05 * H, 0.75 * H, 0.35 * H), v3(target.x, target.y, 0.05), v3(0, 0.1 * H, 0.2 * H));
      lift = needLift * Math.max(ext, wind * 0.5) + (tech.path === 'leap' ? Math.sin(Math.PI * ext) * 0.25 * H : 0);
      wristOverride = add(p, v3(0, -lift, 0));
      spread = 1;
    }
  }

  const wing = (sz) => {
    const shoulder = add(chest, v3(-0.03 * H, 0.03 * H, sz * 0.09 * H));
    const folded = { w: v3(-0.06 * H, 0.45 * H, sz * 0.13 * H), t: v3(-0.48 * H, 0.44 * H, sz * 0.07 * H) };
    const open = { w: v3(0.0, 0.62 * H, sz * 0.38 * H), t: v3(-0.15 * H, 0.75 * H + Math.sin(time * 25) * 0.15 * H * spread, sz * 0.85 * H) };
    let w = lerp3(folded.w, open.w, spread);
    let t = lerp3(folded.t, open.t, spread);
    if (wristOverride) {
      w = v3(wristOverride.x, wristOverride.y, sz * Math.abs(wristOverride.z));
      t = add(w, v3(-0.2 * H, 0.15 * H, sz * 0.35 * H));
    }
    return { shoulder, w: add(w, v3(0, 0, roll)), t };
  };
  const L = wing(-1);
  const R = wing(1);

  const leg = (sz, ph) => {
    const hipP = v3(-0.02 * H, 0.32 * H, sz * 0.07 * H + roll);
    const dx = sp > 0.05 ? Math.sin(ph) * Math.min(0.08 * H, sp * 0.05) * Math.sign(va || 1) : 0;
    const foot = v3(dx, sp > 0.05 ? Math.max(0, Math.cos(ph)) * 0.04 * H : 0.02 * H, sz * 0.08 * H);
    const ik = solveTwoBone(hipP, foot, 0.19 * H, 0.2 * H, v3(-1, 0, 0));
    return { hip: hipP, ankle: ik.mid, foot: ik.end, toe: add(ik.end, v3(0.09 * H, -0.015 * H, 0)) };
  };
  const ll = leg(-1, g);
  const rl = leg(1, g + Math.PI);
  const beak = add(head, v3(0.12 * H, -0.02 * H, 0));
  const J = {
    beak, head, neckTop, neckMid, chest, tail,
    lShoulder: L.shoulder, lWrist: L.w, lTip: L.t, rShoulder: R.shoulder, rWrist: R.w, rTip: R.t,
    lHip: ll.hip, lAnkle: ll.ankle, lFoot: ll.foot, lToe: ll.toe,
    rHip: rl.hip, rAnkle: rl.ankle, rFoot: rl.foot, rToe: rl.toe,
  };
  if (lift) for (const n of JOINTS) J[n] = add(J[n], v3(0, lift, 0));
  return J;
}

export function birdPose(f, time) {
  let J = birdLocal(f, time, false);
  if (f.fallT > 0) {
    const R = rollToSide(birdLocal(f, 0, true), JOINTS, f.body.height * 0.4, f.body.width / 2);
    R.head = v3(R.head.x + 0.1 * f.body.height, 0.03, R.head.z);
    R.beak = v3(R.beak.x + 0.1 * f.body.height, 0.02, R.beak.z);
    J = blendPose(J, R, f.fallT, JOINTS);
  }
  return toWorld(J, f, JOINTS);
}

export function birdRegionHeight(f, region) {
  const H = f.body.height;
  if (isLying(f)) return { head: 0.06 * H, body: 0.12 * H, legs: 0.06 * H }[region];
  return { head: 0.5 * H, body: 0.42 * H, legs: 0.15 * H }[region];
}

export const birdPlan = {
  id: 'bird',
  name: 'Bird',
  joints: JOINTS,
  bones: BONES,
  boneWidth: 0.03,
  headJoint: 'head',
  build: buildBird,
  pose: birdPose,
  regionHeight: birdRegionHeight,
  regionJoint: { head: 'head', body: 'chest', legs: 'lAnkle' },
};
