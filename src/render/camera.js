// Perspective orbit camera with automatic framing of the action.
import { add, sub, scale, norm, cross, dot, v3, lerp, clamp } from '../sim/math.js';

/** A body's central joint, whatever its body plan. */
export const centerOf = (e) => e.joints.pelvis || e.joints.mid || e.joints.chest;

export class Camera {
  constructor() {
    this.yaw = 0.3; // 0 = classic side view (looking along -z)
    this.pitch = 0.28;
    this.zoom = 1;
    this.target = v3(0, 0.9, 0);
    this.dist = 6;
    this.fov = (45 * Math.PI) / 180;
    this.width = 800;
    this.height = 450;
    this.auto = true;
    this._update();
  }

  setViewport(w, h) {
    this.width = w;
    this.height = h;
    this._update();
  }

  /** Smoothly follow the standing combatants. */
  follow(entities, dt) {
    const pts = entities.filter((e) => e.state !== 'out').map(centerOf);
    const use = pts.length ? pts : entities.map(centerOf);
    if (!use.length) return;
    let cx = 0;
    let cz = 0;
    for (const p of use) { cx += p.x; cz += p.z; }
    cx /= use.length;
    cz /= use.length;
    let r = 0;
    for (const p of use) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz));
    const k = 1 - Math.exp(-dt * 2.5);
    this.target = v3(lerp(this.target.x, cx, k), 0.85, lerp(this.target.z, cz, k));
    const aspect = this.width / Math.max(1, this.height);
    const want = (Math.max(1.7, r * 1.25 + 1.4) / Math.tan(this.fov / 2)) / Math.min(1, aspect * 0.9);
    this.dist = lerp(this.dist, want / this.zoom, k);
    this._update();
  }

  orbit(dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, 0.02, 1.35);
    this._update();
  }

  _update() {
    const cp = Math.cos(this.pitch);
    this.eye = add(this.target, scale(v3(cp * Math.sin(this.yaw), Math.sin(this.pitch), cp * Math.cos(this.yaw)), this.dist));
    this.forward = norm(sub(this.target, this.eye));
    this.right = norm(cross(this.forward, v3(0, 1, 0)));
    this.up = cross(this.right, this.forward);
    this.focal = this.height / 2 / Math.tan(this.fov / 2);
  }

  /** World point -> screen {x, y, depth, s (pixels per meter at that depth)} or null. */
  project(p) {
    const d = sub(p, this.eye);
    const z = dot(d, this.forward);
    if (z < 0.05) return null;
    const s = this.focal / z;
    return { x: this.width / 2 + dot(d, this.right) * s, y: this.height / 2 - dot(d, this.up) * s, depth: z, s };
  }
}
