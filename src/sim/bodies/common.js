// Helpers shared by body plans.
import { lerp3, smooth } from '../math.js';

/** Local (x fwd, y up, z right) -> world, for every joint. */
export function toWorld(J, f, names) {
  const c = Math.cos(f.facing);
  const s = Math.sin(f.facing);
  const out = {};
  for (const n of names) {
    const p = J[n];
    out[n] = { x: f.pos.x + c * p.x - s * p.z, y: p.y, z: f.pos.z + s * p.x + c * p.z };
  }
  return out;
}

/** World point -> fighter-local coordinates. */
export function worldToLocal(f, p) {
  const c = Math.cos(f.facing);
  const s = Math.sin(f.facing);
  const dx = p.x - f.pos.x;
  const dz = p.z - f.pos.z;
  return { x: c * dx + s * dz, y: p.y, z: -s * dx + c * dz };
}

/** Topple a standing pose onto its side (for animals lying down / dead). */
export function rollToSide(J, names, bodyY, halfWidth) {
  const out = {};
  for (const n of names) {
    const p = J[n];
    out[n] = { x: p.x, y: Math.max(0.01, p.z + halfWidth + 0.03), z: -(p.y - bodyY) * 0.85 };
  }
  return out;
}

export function blendPose(A, B, k, names) {
  const t = smooth(k);
  const out = {};
  for (const n of names) out[n] = lerp3(A[n], B[n], t);
  return out;
}

/** Shared progress curve for any attack: start → chamber → target (+arc) → back. */
export function attackCurve(a, start, chamber, target, arc) {
  const sm = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  if (a.t < a.windup) {
    const k = sm(a.t / a.windup);
    return { p: lerp3(start, chamber, k), ext: 0, wind: k };
  }
  if (a.t < a.impactAt) {
    const e = Math.min(1, (a.t - a.windup) / a.active);
    const k = 1 - (1 - e) * (1 - e);
    const s = Math.sin(Math.PI * k);
    const p = lerp3(chamber, target, k);
    return { p: { x: p.x + arc.x * s, y: p.y + arc.y * s, z: p.z + arc.z * s }, ext: k, wind: 1 };
  }
  const r = sm((a.t - a.impactAt) / a.recovery);
  return { p: lerp3(target, start, r), ext: 1 - r, wind: 1 - r };
}

/** Is this fighter lying on the ground right now (for aiming)? */
export function isLying(f) {
  return f.fallT > 0.5 || f.role === 'bottom';
}
