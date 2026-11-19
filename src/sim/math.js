// Small math helpers shared by the simulation and renderer.
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const easeOut = (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); };
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export const G = 9.81;

export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// 3D vectors as plain {x, y, z} objects (y is up).
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export function norm(a) {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : v3(0, 0, 0);
}
export const lerp3 = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });

/**
 * Analytic two-bone IK (shoulder-elbow-hand, hip-knee-ankle).
 * Returns the middle joint and the (reach-clamped) end joint.
 */
export function solveTwoBone(root, target, l1, l2, poleDir) {
  const d = sub(target, root);
  let dist = len(d);
  const dir = dist > 1e-6 ? scale(d, 1 / dist) : v3(1, 0, 0);
  dist = clamp(dist, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
  const end = add(root, scale(dir, dist));
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let p = sub(poleDir, scale(dir, dot(poleDir, dir)));
  if (len(p) < 1e-6) p = v3(0, 1, 0);
  p = norm(p);
  const mid = add(add(root, scale(dir, a)), scale(p, h));
  return { mid, end };
}
