// Quadruped body plan (dogs, big cats, bears): spine, neck & head, four legs
// (front: shoulder-elbow-paw, hind: hip-stifle-hock-paw), tail. Procedural trot,
// bites, paw swipes, rearing, pounces, lying on the side.
import { TECHNIQUES } from '../techniques.js';
import { v3, add, sub, scale, lerp3, clamp, solveTwoBone, smooth } from '../math.js';
import { toWorld, worldToLocal, rollToSide, blendPose, attackCurve, isLying } from './common.js';

export const JOINTS = [
  'head', 'snout', 'jaw', 'neck', 'chest', 'mid', 'hip', 'tail', 'tailTip',
  'lfShoulder', 'lfElbow', 'lfPaw', 'rfShoulder', 'rfElbow', 'rfPaw',
  'lhHip', 'lhKnee', 'lhHock', 'lhPaw', 'rhHip', 'rhKnee', 'rhHock', 'rhPaw',
];

// [a, b, thickness as a fraction of shoulder height]
export const BONES = [
  ['chest', 'mid', 0.3], ['mid', 'hip', 0.27], ['neck', 'chest', 0.16], ['head', 'neck', 0.12],
  ['head', 'snout', 0.09], ['head', 'jaw', 0.05], ['hip', 'tail', 0.05], ['tail', 'tailTip', 0.035],
  ['chest', 'lfShoulder', 0.08], ['lfShoulder', 'lfElbow', 0.08], ['lfElbow', 'lfPaw', 0.06],
  ['chest', 'rfShoulder', 0.08], ['rfShoulder', 'rfElbow', 0.08], ['rfElbow', 'rfPaw', 0.06],
  ['hip', 'lhHip', 0.09], ['lhHip', 'lhKnee', 0.09], ['lhKnee', 'lhHock', 0.06], ['lhHock', 'lhPaw', 0.05],
  ['hip', 'rhHip', 0.09], ['rhHip', 'rhKnee', 0.09], ['rhKnee', 'rhHock', 0.06], ['rhHock', 'rhPaw', 0.05],
];

/** sizeCm = shoulder height. params: body proportions of the species. */
export function buildQuadruped(sizeCm, massKg, params = {}) {
  const H = sizeCm / 100;
  const p = { length: 1.1, neck: 0.35, head: 0.36, headR: 0.12, width: 0.24, tail: 0.6, neckAngle: 0.7, ...params };
  const L = p.length * H;
  return {
    plan: 'quadruped',
    height: H,
    mass: massKg,
    length: L,
    neck: p.neck * H,
    headLen: p.head * H,
    headRadius: p.headR * H,
    width: p.width * H,
    tailLen: p.tail * H,
    neckAngle: p.neckAngle,
    foreUpper: 0.47 * H,
    foreLower: 0.46 * H,
    hindUpper: 0.45 * H,
    hindLower: 0.42 * H,
    hindFoot: 0.27 * H,
    radius: Math.max(0.42 * L, p.width * H),
    reach: {
      jaw: 0.5 * L + p.neck * H + p.head * H,
      paw: 0.5 * L + 0.75 * H,
      body: 0.5 * L + 0.25 * H,
    },
    surface: { head: p.headR * H, body: p.width * H * 0.6, legs: 0.06 * H },
  };
}

function restOrStanding(f, time, rest) {
  const b = f.body;
  const H = b.height;
  const L = b.length;
  const w = b.width / 2;
  const st = f.style.stance;
  const a = rest ? null : f.action;
  const crouch = rest ? 0 : st.crouch + (f.state === 'stagger' ? 0.05 : 0);

  let lift = 0;
  let pitch = 0; // rotation of the front of the body upward about the hips
  let chest = v3(L / 2, 0.93 * H * (1 - crouch), 0);
  const hip = v3(-L / 2, 0.9 * H * (1 - crouch * 0.6), 0);
  let neckAngle = b.neckAngle - crouch * 1.2;
  let headTarget = null;
  let jawOpen = 0;
  let lead = null; // { paw: 'lf'|'rf', p }
  let frontReach = null; // pounce: front paws forward
  const ls = f.leadSign;

  // gait
  const c = Math.cos(f.facing);
  const s = Math.sin(f.facing);
  const va = rest ? 0 : f.vel.x * c + f.vel.z * s;
  const vb = rest ? 0 : -f.vel.x * s + f.vel.z * c;
  const sp = Math.hypot(va, vb);
  const amp = Math.min(0.28 * H, sp * 0.1);
  const g = f.gaitPhase;
  const step = (phase) => ({
    dx: sp > 0.05 ? (va / sp) * amp * Math.sin(phase) : 0,
    dz: sp > 0.05 ? (vb / sp) * amp * Math.sin(phase) : 0,
    up: sp > 0.05 ? Math.max(0, Math.cos(phase)) * 0.12 * H * Math.min(1, sp / 2) : 0,
  });

  if (!rest && f.state === 'attack' && a) {
    const tech = TECHNIQUES[a.techId];
    const target = v3(clamp(a.aimDist - 0.05, 0.2 * H, 3 * L), a.aimHeight, 0);
    if (tech.limb === 'jaw') {
      const rel = sub(target, chest);
      const { ext, wind } = attackCurve(a, v3(0, 0, 0), v3(0, 0, 0), v3(1, 0, 0), v3(0, 0, 0));
      jawOpen = Math.max(wind * (1 - ext), 0) + (a.t < a.impactAt ? 0.4 * wind : 0);
      headTarget = { p: target, k: ext };
      const needUp = target.y - (b.neck * 0.6) - chest.y;
      if (needUp > 0) pitch = Math.asin(clamp(needUp / L, 0, 0.95)) * Math.max(ext, wind * 0.5);
      if (target.y < 0.5 * H) neckAngle = -0.5;
      void rel;
    } else if (tech.limb === 'leadPaw') {
      const side = ls;
      const shoulder0 = add(chest, v3(0, -0.08 * H, side * w));
      const start = v3(chest.x, 0, side * w);
      const chamber = add(shoulder0, v3(0.1 * H, 0.15 * H, side * 0.2 * H));
      const { p, ext, wind } = attackCurve(a, start, chamber, add(target, v3(0, 0, -side * 0.05)), v3(0, 0.1 * H, side * 0.25 * H));
      const needUp = target.y - chest.y + 0.1 * H;
      pitch = Math.max(0.15, Math.asin(clamp(needUp / L, 0, 1.1))) * Math.max(wind, ext);
      lead = { paw: side < 0 ? 'lf' : 'rf', p };
    } else if (tech.limb === 'body') {
      const { ext } = attackCurve(a, v3(0, 0, 0), v3(0, 0, 0), v3(1, 0, 0), v3(0, 0, 0));
      if (tech.path === 'pounce' || tech.path === 'lunge') {
        lift = Math.sin(Math.PI * ext) * (tech.path === 'pounce' ? 0.35 : 0.15) * H;
        pitch = 0.3 * ext;
      }
      frontReach = ext;
      headTarget = { p: target, k: ext * 0.6 };
      jawOpen = ext;
    }
  }
  // holding a bite (latched) keeps the head on the bite point
  if (!rest && f.role === 'biter' && f.linkView?.bitePoint) {
    const t = worldToLocal(f, f.linkView.bitePoint);
    headTarget = { p: t, k: 1 };
    const needUp = t.y - b.neck * 0.6 - chest.y;
    if (needUp > 0) pitch = Math.asin(clamp(needUp / L, 0, 0.95));
    neckAngle += Math.sin(time * 18) * 0.15; // shaking
  }

  // apply pitch to front body (rotate around hip in the x-y plane)
  const rot = (pt) => {
    if (!pitch) return pt;
    const dx = pt.x - hip.x;
    const dy = pt.y - hip.y;
    return v3(hip.x + dx * Math.cos(pitch) - dy * Math.sin(pitch), hip.y + dx * Math.sin(pitch) + dy * Math.cos(pitch), pt.z);
  };
  chest = rot(chest);
  const mid = rot(lerp3(chest, hip, 0.5));
  const neckBase = add(chest, v3(0.05 * H, 0.04 * H, 0));
  let head = add(neckBase, v3(Math.cos(neckAngle + pitch) * b.neck, Math.sin(neckAngle + pitch) * b.neck, 0));
  if (headTarget) head = lerp3(head, sub(headTarget.p, v3(b.headLen * 0.8, 0, 0)), clamp(headTarget.k, 0, 1));
  const snoutDir = headTarget && headTarget.k > 0.1 ? norm2(sub(headTarget.p, head)) : v3(Math.cos(-0.3), Math.sin(-0.3), 0);
  const snout = add(head, scale(snoutDir, b.headLen));
  const jaw = add(head, add(scale(snoutDir, b.headLen * 0.85), v3(0, -0.06 * H - jawOpen * 0.12 * H, 0)));
  const neck = lerp3(neckBase, head, 0.5);

  // legs
  const legs = {};
  const sides = [['l', -1], ['r', 1]];
  for (const [sName, sz] of sides) {
    const shoulder = rot(add(v3(L / 2, 0.93 * H * (1 - crouch), 0), v3(0, -0.08 * H, sz * w)));
    let paw;
    const ph = g + (sName === 'l' ? 0 : Math.PI);
    const st1 = step(ph);
    if (lead && lead.paw === `${sName}f`) paw = lead.p;
    else if (pitch > 0.35) paw = add(shoulder, v3(0.12 * H, -b.foreUpper * 0.9, 0));
    else if (frontReach != null) paw = lerp3(v3(L / 2 + st1.dx, st1.up, sz * w + st1.dz), add(shoulder, v3(0.7 * H, 0.05 * H, 0)), frontReach);
    else paw = v3(L / 2 + 0.03 * H + st1.dx, st1.up, sz * w + st1.dz);
    const fl = solveTwoBone(shoulder, paw, b.foreUpper, b.foreLower, v3(-1, 0, 0));
    legs[`${sName}fShoulder`] = shoulder;
    legs[`${sName}fElbow`] = fl.mid;
    legs[`${sName}fPaw`] = fl.end;

    const hh = add(hip, v3(0, -0.05 * H, sz * w));
    const st2 = step(ph + Math.PI);
    let hpaw = v3(-L / 2 - 0.05 * H + st2.dx, st2.up, sz * w + st2.dz);
    if (frontReach != null) hpaw = lerp3(hpaw, v3(-L / 2 - 0.45 * H, 0.1 * H, sz * w), frontReach);
    const hock = add(hpaw, v3(-0.08 * H, b.hindFoot, 0));
    const hl = solveTwoBone(hh, hock, b.hindUpper, b.hindLower, v3(1, 0, 0));
    legs[`${sName}hHip`] = hh;
    legs[`${sName}hKnee`] = hl.mid;
    legs[`${sName}hHock`] = hl.end;
    legs[`${sName}hPaw`] = hpaw;
  }
  const wag = Math.sin(time * 6 + f.id) * 0.1 * H;
  const tail = add(hip, v3(-0.12 * H, 0.04 * H, 0));
  const tailTip = add(tail, v3(-b.tailLen * 0.8, -b.tailLen * 0.35, rest ? 0 : wag));

  const J = { head, snout, jaw, neck, chest, mid, hip, tail, tailTip, ...legs };
  if (lift) for (const n of JOINTS) J[n] = add(J[n], v3(0, lift, 0));
  return J;
}

function norm2(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return v3(v.x / l, v.y / l, v.z / l);
}

export function quadrupedPose(f, time) {
  let J = restOrStanding(f, time, false);
  if (f.fallT > 0) {
    const R = rollToSide(restOrStanding(f, 0, true), JOINTS, f.body.height * 0.9, f.body.width / 2);
    J = blendPose(J, R, f.fallT, JOINTS);
  }
  return toWorld(J, f, JOINTS);
}

export function quadrupedRegionHeight(f, region) {
  const H = f.body.height;
  if (isLying(f)) return { head: 0.2 * H, body: 0.3 * H, legs: 0.15 * H }[region];
  if (f.role === 'biter' && f.linkView?.bitePoint && region === 'head') return f.linkView.bitePoint.y;
  const crouch = f.style.stance.crouch;
  return { head: 1.05 * H * (1 - crouch * 0.8), body: 0.75 * H * (1 - crouch * 0.6), legs: 0.4 * H }[region];
}

export const quadrupedPlan = {
  id: 'quadruped',
  name: 'Quadruped',
  joints: JOINTS,
  bones: BONES,
  boneWidth: 0.06,
  headJoint: 'head',
  build: buildQuadruped,
  pose: quadrupedPose,
  regionHeight: quadrupedRegionHeight,
  regionJoint: { head: 'head', body: 'mid', legs: 'lfElbow' },
  forwardOffset: (f) => f.body.length * 0.5,
};
