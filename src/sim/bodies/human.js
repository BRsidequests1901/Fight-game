// Human body plan: anthropometrics (Winter's segment tables) and a procedural
// pose generator that turns a fighter's simulation state into 3D joint positions.
//
// Local frame used while posing: x = forward (facing), y = up, z = fighter's right.
import { TECHNIQUES, isKick } from '../techniques.js';
import {
  v3, add, sub, scale, lerp3, norm, clamp, smooth, easeOut, solveTwoBone,
} from '../math.js';
import { worldToLocal, isLying, attackCurve } from './common.js';

export const JOINTS = [
  'head', 'neck', 'chest', 'pelvis',
  'lShoulder', 'lElbow', 'lHand', 'rShoulder', 'rElbow', 'rHand',
  'lHip', 'lKnee', 'lAnkle', 'lToe', 'rHip', 'rKnee', 'rAnkle', 'rToe',
];

export const BONES = [
  ['neck', 'chest', 0.04], ['chest', 'pelvis', 0.04],
  ['neck', 'lShoulder'], ['lShoulder', 'lElbow'], ['lElbow', 'lHand'],
  ['neck', 'rShoulder'], ['rShoulder', 'rElbow'], ['rElbow', 'rHand'],
  ['pelvis', 'lHip'], ['lHip', 'lKnee'], ['lKnee', 'lAnkle'], ['lAnkle', 'lToe'],
  ['pelvis', 'rHip'], ['rHip', 'rKnee'], ['rKnee', 'rAnkle'], ['rAnkle', 'rToe'],
];

export function buildHumanBody(heightCm, massKg) {
  const H = heightCm / 100;
  const m = massKg;
  const bmi = m / (H * H);
  return {
    plan: 'human',
    height: H,
    mass: m,
    bmi,
    upperArm: 0.186 * H,
    forearm: 0.146 * H,
    hand: 0.108 * H,
    thigh: 0.245 * H,
    shank: 0.246 * H,
    foot: 0.152 * H,
    torso: 0.288 * H, // hip joint to shoulder line
    shoulderWidth: 0.259 * H,
    hipWidth: 0.191 * H,
    headRadius: 0.062 * H,
    hipHeight: 0.53 * H,
    ankleHeight: 0.039 * H,
    armReach: (0.186 + 0.146 + 0.03) * H, // shoulder to knuckles
    legReach: (0.245 + 0.246) * H, // hip to ankle
    radius: 0.105 * H * Math.sqrt(bmi / 23), // horizontal collision radius
    width: 0.259 * H,
    reach: { arm: (0.186 + 0.146 + 0.03) * H, leg: (0.245 + 0.246) * H, body: 0.3 * H },
    surface: { head: 0.055 * H, body: 0.105 * H * Math.sqrt(bmi / 23) * 0.9, legs: 0.06 * H },
  };
}

function crouchOf(f) {
  const st = f.style.stance;
  return st.crouch + 0.03 * (1 - f.staminaFrac()) + (f.state === 'stagger' ? 0.04 : 0);
}

/** World-space height of a target region, used for aiming. */
export function regionHeight(f, region) {
  const b = f.body;
  if (isLying(f)) return { head: 0.08 * b.height, body: 0.1 * b.height, legs: 0.07 * b.height }[region];
  if (f.role === 'top') return { head: 0.62 * b.height, body: 0.45 * b.height, legs: 0.15 * b.height }[region];
  const pelvisY = b.hipHeight * (1 - crouchOf(f));
  const lean = f.style.stance.lean;
  if (region === 'head') return pelvisY + b.torso * Math.cos(lean) + 0.11 * b.height;
  if (region === 'body') return pelvisY + 0.55 * b.torso;
  return pelvisY * 0.62;
}

export const REGION_JOINT = { head: 'head', body: 'chest', legs: 'lKnee' };

function standingPose(f, time) {
  const b = f.body;
  const H = b.height;
  const st = f.style.stance;
  const ls = f.leadSign; // z-side of the lead limbs: -1 = left lead (orthodox)
  const a = f.action;
  const fat = 1 - f.staminaFrac();

  const kneel = f.role === 'top';
  const crouch = crouchOf(f);
  const bounce = f.state === 'ready' ? st.bounce * H * Math.sin(time * Math.PI * 2 * 1.7 + f.id * 1.3) : 0;
  const pelvisY = kneel ? 0.3 * H : b.hipHeight * (1 - crouch) + bounce;
  const yAdj = pelvisY - b.hipHeight;

  // ---- feet & gait
  const halfD = (st.depth * H) / 2;
  const halfW = (st.width * H) / 2;
  let leadFoot = v3(halfD, b.ankleHeight, ls * halfW);
  let rearFoot = v3(-halfD, b.ankleHeight, -ls * halfW);
  const c = Math.cos(f.facing);
  const s = Math.sin(f.facing);
  const va = f.vel.x * c + f.vel.z * s;
  const vb = -f.vel.x * s + f.vel.z * c;
  const sp = Math.hypot(va, vb);
  if (sp > 0.08) {
    const amp = Math.min(0.09 * H, sp * 0.09);
    const ux = va / sp;
    const uz = vb / sp;
    const s1 = Math.sin(f.gaitPhase);
    const lift = 0.035 * H * Math.min(1, sp / 1.5);
    leadFoot = add(leadFoot, v3(ux * amp * s1, Math.max(0, Math.cos(f.gaitPhase)) * lift, uz * amp * s1));
    rearFoot = add(rearFoot, v3(-ux * amp * s1, Math.max(0, -Math.cos(f.gaitPhase)) * lift, -uz * amp * s1));
  }

  if (kneel) {
    leadFoot = v3(-0.24 * H, b.ankleHeight, ls * 0.17 * H);
    rearFoot = v3(-0.24 * H, b.ankleHeight, -ls * 0.17 * H);
  }
  let pelvis = v3(kneel ? 0 : (leadFoot.x + rearFoot.x) / 2 + 0.01 * H, pelvisY, 0);
  let twist = kneel ? 0 : -ls * st.twist; // >0 rotates the left shoulder forward
  let lean = kneel ? 0.45 : st.lean;
  let upperOffset = v3(0, 0, 0); // slips / flinches move the upper body

  // ---- guard
  const gl = f.style.guard.lead;
  const gr = f.style.guard.rear;
  const drop = 0.05 * H * fat;
  let leadHand = v3(gl[0] * H, gl[2] * H + yAdj - drop, ls * gl[1] * H);
  let rearHand = v3(gr[0] * H, gr[2] * H + yAdj - drop, ls * gr[1] * H);
  const lv = f.linkView;
  if (kneel) {
    leadHand = v3(0.28 * H, 0.33 * H, ls * 0.13 * H);
    rearHand = v3(0.26 * H, 0.36 * H, -ls * 0.13 * H);
    if (lv?.sub && lv.subBy === f.id) {
      const tgt = worldToLocal(f, lv.sub === 'choke' ? lv.partnerHead : lv.partnerChest);
      leadHand = add(tgt, v3(-0.03 * H, 0.03 * H, ls * 0.05 * H));
      rearHand = add(tgt, v3(-0.03 * H, 0.03 * H, -ls * 0.05 * H));
      lean = 0.7;
    }
  } else if (f.role === 'clinch' && lv?.partnerHead) {
    const tgt = worldToLocal(f, lv.partnerHead);
    leadHand = add(tgt, v3(-0.06 * H, -0.04 * H, ls * 0.05 * H));
    rearHand = add(tgt, v3(-0.06 * H, -0.04 * H, -ls * 0.05 * H));
    twist *= 0.3;
  }
  if (f.state === 'out' && f.yielded) {
    // hands up: giving up
    leadHand = v3(0.08 * H, 1.08 * H, ls * 0.18 * H);
    rearHand = v3(0.08 * H, 1.08 * H, -ls * 0.18 * H);
  }
  const guardLead = leadHand;
  const guardRear = rearHand;

  const pole = {
    leadArm: v3(-0.35, -1, ls * 0.55),
    rearArm: v3(-0.35, -1, -ls * 0.55),
    leadLeg: kneel ? v3(1, -0.7, ls * 0.3) : v3(1, 0.1, ls * 0.2),
    rearLeg: kneel ? v3(1, -0.7, -ls * 0.3) : v3(1, 0.1, -ls * 0.2),
  };
  let kickingLimb = null;
  const grappleMove = f.state === 'attack' && a && TECHNIQUES[a.techId].limb === 'body';

  if (grappleMove) {
    const tech = TECHNIQUES[a.techId];
    const { ext, wind } = attackCurve(a, v3(0, 0, 0), v3(0, 0, 0), v3(1, 0, 0), v3(0, 0, 0));
    const k = Math.max(ext, wind * 0.6);
    const reachX = clamp(a.aimDist - 0.1 * H, 0.15 * H, 0.6 * H);
    if (tech.path === 'shoot') {
      pelvis = add(pelvis, v3(0.05 * H * k, -0.16 * H * k, 0));
      lean += 0.8 * k;
      leadHand = lerp3(leadHand, v3(reachX, 0.35 * H, ls * 0.1 * H), k);
      rearHand = lerp3(rearHand, v3(reachX, 0.35 * H, -ls * 0.1 * H), k);
      leadFoot = lerp3(leadFoot, v3(0.15 * H, b.ankleHeight, ls * 0.1 * H), k);
    } else if (tech.path === 'clinch' || tech.path === 'guardPull') {
      leadHand = lerp3(leadHand, v3(reachX, a.aimHeight - 0.05 * H, ls * 0.06 * H), k);
      rearHand = lerp3(rearHand, v3(reachX, a.aimHeight - 0.05 * H, -ls * 0.06 * H), k);
      if (tech.path === 'guardPull') pelvis = add(pelvis, v3(0, -0.2 * H * ext, 0));
    } else if (tech.path === 'throw') {
      twist = -ls * st.twist * (1 - 2.6 * k);
      lean += 0.55 * k;
      pelvis = add(pelvis, v3(0.06 * H * k, -0.06 * H * k, 0));
      leadHand = lerp3(leadHand, v3(0.3 * H, 0.85 * H, ls * 0.15 * H), k);
      rearHand = lerp3(rearHand, v3(0.25 * H, 0.75 * H, -ls * 0.05 * H), k);
    }
  } else if (f.state === 'attack' && a) {
    const tech = TECHNIQUES[a.techId];
    const limb = a.limb;
    const side = limb.startsWith('lead') ? ls : -ls;
    const kick = isKick(tech);
    const start = kick ? (limb === 'leadLeg' ? leadFoot : rearFoot) : limb === 'leadHand' ? leadHand : rearHand;
    let target = v3(clamp(a.aimDist - 0.06 * H, 0.15 * H, 1.2 * H), a.aimHeight, 0);
    let chamber = add(start, v3(-0.03 * H, -0.01 * H, 0));
    let arc = v3(0, 0, 0);
    switch (tech.path) {
      case 'hook':
        chamber = add(start, v3(-0.02 * H, 0, side * 0.08 * H));
        arc = v3(-0.03 * H, 0, side * 0.16 * H);
        break;
      case 'uppercut':
        chamber = add(start, v3(0, -0.13 * H, 0));
        arc = v3(0, -0.06 * H, 0);
        break;
      case 'claw':
        chamber = add(start, v3(-0.02 * H, 0.12 * H, side * 0.03 * H));
        target = add(target, v3(0, -0.05 * H, 0));
        arc = v3(0.03 * H, 0.06 * H, 0);
        break;
      case 'elbow':
        target = v3(Math.min(target.x, 0.3 * H), a.aimHeight, -side * 0.05 * H);
        chamber = add(start, v3(-0.02 * H, 0.03 * H, side * 0.12 * H));
        arc = v3(0, 0.02 * H, side * 0.1 * H);
        pole[limb === 'leadHand' ? 'leadArm' : 'rearArm'] = v3(0.2, 0.3, side);
        break;
      case 'knee':
        target = v3(0, 0.33 * H, side * 0.05 * H);
        chamber = add(start, v3(0.05 * H, 0.18 * H, 0));
        pole[limb] = v3(1, 0.4, side * 0.1);
        break;
      case 'frontKick':
        chamber = v3(0.08 * H, 0.3 * H, side * halfW * 0.6);
        target = add(target, v3(0, 0, side * 0.03 * H));
        pole[limb] = v3(1, 0.3, side * 0.2);
        break;
      case 'roundKick':
        chamber = add(start, v3(0.02 * H, 0.28 * H, side * 0.18 * H));
        arc = v3(0, 0.04 * H, side * 0.2 * H);
        pole[limb] = v3(0.2, 0.6, side);
        break;
      case 'sideKick':
        chamber = v3(0, 0.33 * H, 0);
        pole[limb] = v3(0.3, 0.6, side);
        break;
      case 'stomp':
        chamber = v3(Math.min(target.x, 0.35 * H) - 0.05 * H, 0.38 * H, side * 0.05 * H);
        target = v3(Math.min(target.x, 0.42 * H), Math.max(a.aimHeight, b.ankleHeight), 0);
        pole[limb] = v3(1, 0.3, side * 0.2);
        break;
      case 'soccer':
        chamber = v3(-0.25 * H, 0.2 * H, side * halfW);
        pole[limb] = v3(1, -0.2, side * 0.2);
        break;
      case 'groundStrike':
        chamber = add(start, v3(-0.05 * H, 0.15 * H, side * 0.04 * H));
        target = v3(clamp(a.aimDist - 0.03 * H, 0.1 * H, 0.5 * H), a.aimHeight + 0.03 * H, 0);
        break;
      default:
        break;
    }
    const { p, ext } = attackCurve(a, start, chamber, target, arc);
    twist *= 1 - tech.twist * ext;
    lean -= (tech.leanBack || 0) * ext;
    if (kick) {
      kickingLimb = limb;
      if (limb === 'leadLeg') leadFoot = p; else rearFoot = p;
      pelvis = add(pelvis, v3((limb === 'rearLeg' ? 0.05 : -0.04) * H * ext, 0, 0));
      if (tech.path === 'roundKick') rearHand = add(rearHand, v3(-0.1 * H * ext, -0.15 * H * ext, 0));
    } else if (limb === 'leadHand') {
      leadHand = p;
    } else {
      rearHand = p;
    }
  } else if (f.state === 'defend' && a) {
    const env = smooth(a.t / 0.07) * smooth((a.duration - a.t) / 0.1);
    if (a.type === 'block') {
      const hy = (a.region === 'body' ? 0.66 : 0.9) * H + yAdj;
      leadHand = lerp3(guardLead, v3(0.13 * H, hy, ls * 0.05 * H), env);
      rearHand = lerp3(guardRear, v3(0.11 * H, hy + 0.01 * H, -ls * 0.05 * H), env);
      pelvis = add(pelvis, v3(0, -0.02 * H * env, 0));
    } else if (a.type === 'slip') {
      upperOffset = v3(0, -0.03 * H * env, a.slipSide * 0.09 * H * env);
      lean += 0.1 * env;
    } else if (a.type === 'check') {
      leadFoot = lerp3(leadFoot, v3(halfD + 0.03 * H, 0.2 * H, ls * halfW * 0.8), env);
      pole.leadLeg = v3(1, 0.2, ls * 0.5);
    } else if (a.type === 'retreat') {
      lean -= 0.08 * env;
    }
  } else if (f.state === 'stagger' && a) {
    const env = Math.sin(Math.PI * clamp(a.t / a.duration, 0, 1));
    lean -= 0.25 * env * (f.flinch + 0.3);
    leadHand = add(leadHand, v3(0, -0.08 * H * env, 0));
    rearHand = add(rearHand, v3(0, -0.08 * H * env, 0));
  }
  lean -= 0.12 * f.flinch;

  // ---- spine, head, shoulders, hips
  const neck = add(add(pelvis, v3(Math.sin(lean) * b.torso, Math.cos(lean) * b.torso, 0)), upperOffset);
  const head = add(neck, v3(Math.sin(lean) * 0.06 * H + 0.01 * H - 0.03 * H * f.flinch, 0.11 * H, 0));
  const chest = lerp3(pelvis, neck, 0.55);
  const sAxis = v3(-Math.sin(twist), 0, Math.cos(twist)); // toward the right shoulder
  const rShoulder = add(add(neck, scale(sAxis, b.shoulderWidth / 2)), v3(0, -0.015 * H, 0));
  const lShoulder = add(sub(neck, scale(sAxis, b.shoulderWidth / 2)), v3(0, -0.015 * H, 0));
  const hAxis = v3(-Math.sin(twist * 0.5), 0, Math.cos(twist * 0.5));
  const rHip = add(pelvis, scale(hAxis, b.hipWidth / 2));
  const lHip = sub(pelvis, scale(hAxis, b.hipWidth / 2));

  const leadIsLeft = ls < 0;
  const leadShoulder = leadIsLeft ? lShoulder : rShoulder;
  const rearShoulder = leadIsLeft ? rShoulder : lShoulder;
  const leadHip = leadIsLeft ? lHip : rHip;
  const rearHip = leadIsLeft ? rHip : lHip;
  leadHand = add(leadHand, upperOffset);
  rearHand = add(rearHand, upperOffset);

  const armL2 = b.forearm + 0.3 * b.hand;
  const la = solveTwoBone(leadShoulder, leadHand, b.upperArm, armL2, pole.leadArm);
  const ra = solveTwoBone(rearShoulder, rearHand, b.upperArm, armL2, pole.rearArm);
  const ll = solveTwoBone(leadHip, leadFoot, b.thigh, b.shank, pole.leadLeg);
  const rl = solveTwoBone(rearHip, rearFoot, b.thigh, b.shank, pole.rearLeg);

  const toe = (leg, sideSign, yaw, kicking) => {
    if (kicking) return add(leg.end, scale(norm(sub(leg.end, leg.mid)), 0.08 * H));
    return add(leg.end, v3(0.11 * H * Math.cos(yaw), -b.ankleHeight + 0.01 * H, sideSign * 0.11 * H * Math.sin(yaw)));
  };
  const leadToe = toe(ll, ls, 0.15, kickingLimb === 'leadLeg');
  const rearToe = toe(rl, -ls, 0.7, kickingLimb === 'rearLeg');

  const J = { head, neck, chest, pelvis };
  const put = (prefix, sh, arm, hip, leg, t) => {
    J[`${prefix}Shoulder`] = sh;
    J[`${prefix}Elbow`] = arm.mid;
    J[`${prefix}Hand`] = arm.end;
    J[`${prefix}Hip`] = hip;
    J[`${prefix}Knee`] = leg.mid;
    J[`${prefix}Ankle`] = leg.end;
    J[`${prefix}Toe`] = t;
  };
  put(leadIsLeft ? 'l' : 'r', leadShoulder, la, leadHip, ll, leadToe);
  put(leadIsLeft ? 'r' : 'l', rearShoulder, ra, rearHip, rl, rearToe);
  return J;
}

function lyingPose(f) {
  const b = f.body;
  const H = b.height;
  const conscious = f.state !== 'out' && f.consciousness() > 0.05;
  const elev = conscious ? 0.45 : 0.04; // a conscious fighter props up on the elbows
  const pelvis = v3(-0.42 * H, 0.09 * H, 0);
  const dir = v3(-Math.cos(elev), Math.sin(elev), 0);
  const neck = add(pelvis, scale(dir, b.torso));
  const head = add(neck, add(scale(dir, 0.09 * H), v3(0, 0.03 * H, 0)));
  const chest = lerp3(pelvis, neck, 0.55);
  const sw = b.shoulderWidth / 2;
  const lShoulder = add(neck, v3(0, -0.01 * H, -sw));
  const rShoulder = add(neck, v3(0, -0.01 * H, sw));
  const handX = conscious ? pelvis.x - 0.12 * H : neck.x + 0.05 * H;
  const handZ = conscious ? 0.2 * H : 0.36 * H;
  const armL2 = b.forearm + 0.3 * b.hand;
  const up = v3(0, 1, 0);
  const lv = f.role === 'bottom' && f.state !== 'out' ? f.linkView : null;
  let lHandT = v3(handX, 0.03 * H, -handZ);
  let rHandT = v3(handX, 0.03 * H, handZ);
  if (lv?.partnerChest) {
    // fighting off the opponent on top
    const pc = worldToLocal(f, lv.partnerChest);
    lHandT = add(pc, v3(0, 0.05 * H, -0.08 * H));
    rHandT = add(pc, v3(0, 0.05 * H, 0.08 * H));
  }
  const la = solveTwoBone(lShoulder, lHandT, b.upperArm, armL2, add(up, v3(0, 0, -0.5)));
  const ra = solveTwoBone(rShoulder, rHandT, b.upperArm, armL2, add(up, v3(0, 0, 0.5)));
  const lHip = add(pelvis, v3(0, 0, -b.hipWidth / 2));
  const rHip = add(pelvis, v3(0, 0, b.hipWidth / 2));
  const spread = 0.12 * H + (f.id % 3) * 0.02 * H;
  const footX = pelvis.x + (conscious ? 0.36 : 0.46) * H;
  let lFootT = v3(footX, 0.04 * H, -spread);
  let rFootT = v3(footX, 0.04 * H, spread);
  if (lv?.partnerChest && lv.position === 'guard') {
    // closed guard: legs wrapped around the opponent (or locking a triangle)
    const anchor = worldToLocal(f, lv.sub && lv.subBy === f.id ? lv.partnerHead : lv.partnerChest);
    lFootT = add(anchor, v3(-0.05 * H, 0.02 * H, -0.12 * H));
    rFootT = add(anchor, v3(-0.05 * H, 0.02 * H, 0.12 * H));
  }
  const ll = solveTwoBone(lHip, lFootT, b.thigh, b.shank, up);
  const rl = solveTwoBone(rHip, rFootT, b.thigh, b.shank, up);
  return {
    head, neck, chest, pelvis, lShoulder, rShoulder,
    lElbow: la.mid, lHand: la.end, rElbow: ra.mid, rHand: ra.end,
    lHip, rHip, lKnee: ll.mid, lAnkle: ll.end, rKnee: rl.mid, rAnkle: rl.end,
    lToe: add(ll.end, v3(0.02 * H, 0.08 * H, 0)), rToe: add(rl.end, v3(0.02 * H, 0.08 * H, 0)),
  };
}

/** Full world-space pose for a fighter at the given simulation time. */
export function humanPose(f, time) {
  let J = standingPose(f, time);
  if (f.fallT > 0) {
    const L = lyingPose(f);
    const k = smooth(f.fallT);
    const blended = {};
    for (const name of JOINTS) blended[name] = lerp3(J[name], L[name], k);
    J = blended;
  }
  const c = Math.cos(f.facing);
  const s = Math.sin(f.facing);
  const out = {};
  for (const name of JOINTS) {
    const p = J[name];
    out[name] = { x: f.pos.x + c * p.x - s * p.z, y: p.y, z: f.pos.z + s * p.x + c * p.z };
  }
  return out;
}

export const humanPlan = {
  id: 'human',
  name: 'Human',
  joints: JOINTS,
  bones: BONES,
  boneWidth: 0.026,
  headJoint: 'head',
  build: buildHumanBody,
  pose: humanPose,
  regionHeight,
  regionJoint: REGION_JOINT,
};
