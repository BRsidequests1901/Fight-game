// The deterministic world: fixed timestep, seeded RNG, no DOM access.
// Runs identically in the browser and in Node (tests, batch tools).
import { createRng } from './rng.js';
import { Fighter } from './fighter.js';
import { think, perceiveThreats, continueCombo } from './ai.js';
import { resolveStrike, updateAim, checkCollapse, setOut } from './combat.js';
import { normalizeConfig, expandTeam } from './scenario.js';
import { wrapAngle, clamp } from './math.js';
import { TECHNIQUES } from './techniques.js';

export const FIXED_DT = 1 / 120;

export class Simulation {
  constructor(config) {
    this.config = normalizeConfig(config);
    this.rng = createRng(this.config.seed);
    this.time = 0;
    this.events = [];
    this.fighters = [];
    this.over = false;
    this.result = null;

    const rosters = this.config.teams.map(expandTeam);
    const total = rosters.reduce((n, r) => n + r.length, 0);
    this.arenaRadius = this.config.arena.radius ?? 4.5 + 0.45 * total;
    const nTeams = rosters.length;
    rosters.forEach((roster, ti) => {
      const baseAng = Math.PI + (2 * Math.PI * ti) / nTeams;
      const n = roster.length;
      roster.forEach((cfg, i) => {
        const f = new Fighter(this.fighters.length, ti, cfg, this.rng);
        const spread = n > 1 ? i / (n - 1) - 0.5 : 0;
        const ang = baseAng + spread * Math.min(2.4, 0.5 * n);
        const r = n > 1 ? 2.6 + 0.1 * n : 1.8;
        f.pos = { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
        f.facing = ang + Math.PI;
        this.fighters.push(f);
      });
    });
  }

  emit(ev) {
    ev.t = this.time;
    this.events.push(ev);
  }

  byId(id) {
    return id == null ? null : this.fighters[id] || null;
  }

  step(dt = FIXED_DT) {
    this.time += dt;
    for (const f of this.fighters) f.updatePhysiology(dt);
    if (!this.over) perceiveThreats(this);
    for (const f of this.fighters) this.updateAction(f, dt);
    for (const f of this.fighters) {
      if (f.state !== 'ready') continue;
      if (this.over) { f.intent = { x: 0, z: 0 }; continue; }
      f.thinkTimer -= dt;
      if (f.thinkTimer <= 0) think(f, this);
    }
    this.integrate(dt);
    this.checkEnd();
  }

  updateAction(f, dt) {
    const a = f.action;
    switch (f.state) {
      case 'attack':
        a.t += dt;
        if (!a.resolved) updateAim(this, f);
        if (!a.resolved && a.t >= a.impactAt) {
          a.resolved = true;
          resolveStrike(this, f, a);
        }
        if (f.state === 'attack' && a.t >= a.total) {
          f.endAction();
          continueCombo(this, f);
        }
        break;
      case 'defend':
      case 'stagger':
        a.t += dt;
        if (a.t >= a.duration) f.endAction();
        break;
      case 'down':
        f.downTimer += dt;
        if (f.rising) {
          f.fallT -= dt / 0.8;
          if (f.fallT <= 0) {
            f.fallT = 0;
            f.rising = false;
            f.state = 'ready';
            f.balance = 0.6;
          }
        } else {
          f.fallT = Math.min(1, f.fallT + dt / 0.45);
          if (f.downTimer >= f.getUpAt) {
            if (f.consciousness() > 0.25) {
              f.rising = true;
              this.emit({ type: 'getup', fighter: f.id });
            } else {
              f.getUpAt += 0.5;
            }
          }
          if (f.downTimer > 10 && !f.rising) setOut(this, f, 'KO (counted out)');
        }
        break;
      case 'out':
        f.fallT = Math.min(1, f.fallT + dt / 0.45);
        break;
      default:
        break;
    }
  }

  integrate(dt) {
    for (const f of this.fighters) {
      if (!f.isStanding()) {
        const damp = Math.exp(-8 * dt);
        f.vel.x *= damp;
        f.vel.z *= damp;
        f.pos.x += f.vel.x * dt;
        f.pos.z += f.vel.z * dt;
        continue;
      }
      const a = f.action;
      const target = this.byId(f.targetId);
      let desired = { x: 0, z: 0 };
      let turnRate = 9;
      if (f.state === 'ready') {
        desired = f.intent;
      } else if (f.state === 'attack') {
        turnRate = a.t < a.windup ? 5 : 1.5;
        if (a.t < a.impactAt) {
          const step = TECHNIQUES[a.techId].step / a.impactAt;
          desired = { x: Math.cos(f.facing) * step, z: Math.sin(f.facing) * step };
        }
      } else if (f.state === 'defend') {
        if (a.type === 'retreat') {
          const atk = this.byId(a.attackerId);
          const dx = f.pos.x - atk.pos.x;
          const dz = f.pos.z - atk.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          const sp = f.maxMoveSpeed() * 1.3;
          desired = { x: (dx / d) * sp, z: (dz / d) * sp };
        }
      } else if (f.state === 'stagger') {
        turnRate = 2;
      }
      const maxA = f.phys.accel * f.fatigue() * (1 - 0.5 * f.legTrauma) * dt * (f.state === 'stagger' ? 0.3 : 1);
      let dvx = desired.x - f.vel.x;
      let dvz = desired.z - f.vel.z;
      const dv = Math.hypot(dvx, dvz);
      if (dv > maxA) { dvx *= maxA / dv; dvz *= maxA / dv; }
      f.vel.x += dvx;
      f.vel.z += dvz;
      f.pos.x += f.vel.x * dt;
      f.pos.z += f.vel.z * dt;
      f.gaitPhase += (Math.hypot(f.vel.x, f.vel.z) * dt * 2 * Math.PI) / 0.55;
      if (target && target.state !== 'out') {
        const want = Math.atan2(target.pos.z - f.pos.z, target.pos.x - f.pos.x);
        const diff = wrapAngle(want - f.facing);
        f.facing = wrapAngle(f.facing + clamp(diff, -turnRate * dt, turnRate * dt));
      }
    }
    // body collisions (standing fighters)
    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i];
      if (!a.isStanding()) continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j];
        if (!b.isStanding()) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const minD = a.body.radius + b.body.radius;
        if (d < minD && d > 1e-6) {
          const nx = dx / d;
          const nz = dz / d;
          const overlap = minD - d;
          const wa = b.body.mass / (a.body.mass + b.body.mass);
          a.pos.x -= nx * overlap * wa;
          a.pos.z -= nz * overlap * wa;
          b.pos.x += nx * overlap * (1 - wa);
          b.pos.z += nz * overlap * (1 - wa);
          const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
          if (rel < 0) {
            a.vel.x += nx * rel * wa;
            a.vel.z += nz * rel * wa;
            b.vel.x -= nx * rel * (1 - wa);
            b.vel.z -= nz * rel * (1 - wa);
          }
        }
      }
    }
    // arena boundary
    for (const f of fs) {
      const r = Math.hypot(f.pos.x, f.pos.z);
      const max = this.arenaRadius - f.body.radius;
      if (r > max) {
        const nx = f.pos.x / r;
        const nz = f.pos.z / r;
        f.pos.x = nx * max;
        f.pos.z = nz * max;
        const out = f.vel.x * nx + f.vel.z * nz;
        if (out > 0) { f.vel.x -= nx * out; f.vel.z -= nz * out; }
      }
    }
    for (const f of fs) if (f.isStanding()) checkCollapse(this, f);
  }

  checkEnd() {
    if (this.over) return;
    const alive = new Set(this.fighters.filter((f) => f.state !== 'out').map((f) => f.team));
    if (alive.size <= 1) {
      const winner = alive.size === 1 ? [...alive][0] : null;
      const lastOut = [...this.events].reverse().find((e) => e.type === 'out');
      this.finish({ winner, method: lastOut ? lastOut.reason : 'last standing' });
      return;
    }
    const limit = this.config.rules.timeLimit;
    if (limit > 0 && this.time >= limit) {
      const dmg = this.config.teams.map((_, ti) => this.fighters
        .filter((f) => f.team === ti)
        .reduce((s, f) => s + f.concussion * 4 + f.daze + f.bodyTrauma * 2 + f.legTrauma * 1.5
          + f.knockdowns * 1.5 + (f.state === 'out' ? 5 : 0), 0) / this.fighters.filter((f) => f.team === ti).length);
      let best = 0;
      for (let i = 1; i < dmg.length; i++) if (dmg[i] < dmg[best]) best = i;
      const sorted = [...dmg].sort((x, y) => x - y);
      const close = sorted.length > 1 && sorted[1] - sorted[0] < 0.15;
      this.finish({ winner: close ? null : best, method: close ? 'draw (time)' : 'decision (time)', damage: dmg });
    }
  }

  finish(result) {
    this.over = true;
    this.result = { ...result, time: this.time };
    this.emit({ type: 'end', ...this.result });
  }

  /** Run headless until the fight ends (plus `tail` seconds), or maxTime. */
  runToEnd({ maxTime = 3600, tail = 0 } = {}) {
    while (this.time < maxTime) {
      this.step(FIXED_DT);
      if (this.over && this.time >= this.result.time + tail) break;
    }
    return this.result;
  }
}
