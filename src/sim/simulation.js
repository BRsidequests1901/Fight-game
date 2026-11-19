// The deterministic world: fixed timestep, seeded RNG, no DOM access.
// Runs identically in the browser and in Node (tests, batch tools).
import { createRng } from './rng.js';
import { Fighter } from './fighter.js';
import { think, perceiveThreats, continueCombo } from './ai.js';
import { resolveStrike, updateAim, afterDamage } from './combat.js';
import { tickLinks, grappleThink } from './grapple.js';
import { updateInjuries } from './injury.js';
import { normalizeConfig, expandTeam } from './scenario.js';
import { RULESETS, applyRealism } from './rules.js';
import { wrapAngle, clamp, lerp } from './math.js';
import { TECHNIQUES } from './techniques.js';

export const FIXED_DT = 1 / 120;
const STALEMATE_SECONDS = 90;

export class Simulation {
  constructor(config) {
    this.config = normalizeConfig(config);
    this.ruleset = RULESETS[this.config.rules.mode];
    this.rng = createRng(this.config.seed);
    this.time = 0;
    this.events = [];
    this.fighters = [];
    this.links = [];
    this.nextLinkId = 1;
    this.over = false;
    this.result = null;
    this.lastDamageTime = 0;

    const rosters = this.config.teams.map(expandTeam);
    const nTeams = rosters.length;
    let area = 0;
    rosters.forEach((roster, ti) => roster.forEach((cfg) => {
      const f = new Fighter(this.fighters.length, ti, cfg, this.rng);
      area += Math.PI * (f.body.radius * 3) ** 2;
      this.fighters.push(f);
    }));
    this.arenaRadius = this.config.arena.radius ?? Math.max(5, 3 + Math.sqrt(area / Math.PI) * 1.6);
    // spawn: small teams in an arc, crowds in a packed cluster
    let idx = 0;
    rosters.forEach((roster, ti) => {
      const baseAng = Math.PI + (2 * Math.PI * ti) / nTeams;
      const n = roster.length;
      const members = this.fighters.slice(idx, idx + n);
      idx += n;
      if (n <= 6) {
        members.forEach((f, i) => {
          const spread = n > 1 ? i / (n - 1) - 0.5 : 0;
          const ang = baseAng + spread * Math.min(2.4, 0.5 * n);
          const r = n > 1 ? 2.6 + 0.1 * n : Math.max(1.8, f.body.radius * 3);
          f.pos = { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
          f.facing = ang + Math.PI;
        });
      } else {
        const spacing = members[0].body.radius * 2.6;
        const cx = Math.cos(baseAng) * this.arenaRadius * 0.5;
        const cz = Math.sin(baseAng) * this.arenaRadius * 0.5;
        members.forEach((f, i) => {
          const rr = spacing * Math.sqrt(i + 0.5);
          const a = i * 2.39996;
          f.pos = { x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr };
          f.facing = baseAng + Math.PI;
        });
      }
    });
    applyRealism(this);
    this.lethalChokeTime = lerp(30, 150, this.realism);
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
    for (const f of this.fighters) {
      f.updatePhysiology(dt);
      if (f.role === 'bitten') f.balance -= dt * 0.6; // being dragged
      updateInjuries(this, f, dt);
    }
    if (!this.over) perceiveThreats(this);
    for (const f of this.fighters) this.updateAction(f, dt);
    for (const f of this.fighters) {
      if (f.state !== 'ready' && f.state !== 'grapple') continue;
      if (this.over) { f.intent = { x: 0, z: 0 }; continue; }
      f.thinkTimer -= dt;
      if (f.thinkTimer > 0) continue;
      if (f.state === 'grapple') grappleThink(f, this); else think(f, this);
    }
    this.integrate(dt);
    tickLinks(this, dt);
    for (const f of this.fighters) {
      if (f.state === 'out') continue;
      afterDamage(this, f);
      if (f.role === 'bottom' || f.state === 'down') f.fallT = Math.min(1, f.fallT + dt / 0.45);
    }
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
          if (f.state === 'ready') continueCombo(this, f);
        }
        break;
      case 'defend':
      case 'stagger':
        a.t += dt;
        if (a.t >= a.duration) f.endAction();
        break;
      case 'grapple':
        if (f.role !== 'bottom') f.fallT = Math.max(0, f.fallT - dt / 0.6);
        break;
      case 'down': {
        f.downTimer += dt;
        if (f.rising) {
          f.fallT -= dt / 0.8;
          if (f.fallT <= 0) {
            f.fallT = 0;
            f.rising = false;
            f.noCount = false;
            f.state = 'ready';
            f.balance = 0.6;
          }
        } else {
          if (f.downTimer >= f.getUpAt) {
            if (f.consciousness() > 0.25 && f.canStand()) {
              f.rising = true;
              if (!f.noCount) this.emit({ type: 'getup', fighter: f.id });
            } else {
              f.getUpAt += 0.5;
            }
          }
          if (this.ruleset.count && !f.noCount && f.downTimer > 10 && !f.rising) {
            f.countedOut = true;
            afterDamage(this, f);
          }
        }
        break;
      }
      case 'out':
        if (f.yielded) {
          // walks (or flies / runs) away from the fight
          f.fallT = Math.max(0, f.fallT - dt / 0.8);
          const r = Math.hypot(f.pos.x, f.pos.z) || 1;
          const sp = Math.min(1.2, f.phys.moveSpeed * 0.4);
          f.vel = { x: (f.pos.x / r) * sp, z: (f.pos.z / r) * sp };
          if (r < this.arenaRadius - f.body.radius) {
            f.pos.x += f.vel.x * dt;
            f.pos.z += f.vel.z * dt;
          }
          f.facing = Math.atan2(f.pos.z, f.pos.x);
          f.gaitPhase += sp * dt * 2 * Math.PI / 0.55;
        } else {
          f.fallT = Math.min(1, f.fallT + dt / 0.45);
        }
        break;
      default:
        break;
    }
  }

  integrate(dt) {
    for (const f of this.fighters) {
      if (f.state === 'out') continue;
      if (f.link && f.role !== 'bitten') continue; // positions owned by the link
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
      let accelBoost = 1;
      if (f.state === 'ready') {
        desired = f.intent;
      } else if (f.state === 'attack') {
        turnRate = a.t < a.windup ? 5 : 1.5;
        if (a.t < a.impactAt) {
          const step = TECHNIQUES[a.techId].step / a.impactAt;
          desired = { x: Math.cos(f.facing) * step, z: Math.sin(f.facing) * step };
          accelBoost = 3; // lunges and pounces are explosive
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
      const maxA = f.phys.accel * accelBoost * f.fatigue() * (1 - 0.5 * f.legTrauma) * dt * (f.state === 'stagger' ? 0.3 : 1);
      let dvx = desired.x - f.vel.x;
      let dvz = desired.z - f.vel.z;
      const dv = Math.hypot(dvx, dvz);
      if (dv > maxA) { dvx *= maxA / dv; dvz *= maxA / dv; }
      f.vel.x += dvx;
      f.vel.z += dvz;
      f.pos.x += f.vel.x * dt;
      f.pos.z += f.vel.z * dt;
      f.gaitPhase += (Math.hypot(f.vel.x, f.vel.z) * dt * 2 * Math.PI) / Math.max(0.2, 0.3 * f.body.height + 0.03);
      if (target && target.state !== 'out') {
        const want = Math.atan2(target.pos.z - f.pos.z, target.pos.x - f.pos.x);
        const diff = wrapAngle(want - f.facing);
        f.facing = wrapAngle(f.facing + clamp(diff, -turnRate * dt, turnRate * dt));
      }
    }
    // body collisions (standing, unlinked fighters)
    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i];
      if (!a.isStanding() || (a.link && a.role !== 'bitten')) continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j];
        if (!b.isStanding() || (b.link && b.role !== 'bitten') || (a.link && a.link === b.link)) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const minD = a.body.radius + b.body.radius;
        if (Math.abs(dx) > minD || Math.abs(dz) > minD) continue;
        const d = Math.hypot(dx, dz);
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
    const timeUp = limit > 0 && this.time >= limit;
    const stalemate = this.time - this.lastDamageTime > STALEMATE_SECONDS || (limit === 0 && this.time > 900);
    if (timeUp || stalemate) {
      const dmg = this.config.teams.map((_, ti) => {
        const team = this.fighters.filter((f) => f.team === ti);
        return team.reduce((s, f) => s + f.concussion * 4 + f.daze + f.bodyTrauma * 2 + f.legTrauma * 1.5
          + f.knockdowns * 1.5 + f.bloodLossFrac() * 6 + f.injuries.length + (f.state === 'out' ? 5 : 0), 0) / team.length;
      });
      let best = 0;
      for (let i = 1; i < dmg.length; i++) if (dmg[i] < dmg[best]) best = i;
      const sorted = [...dmg].sort((x, y) => x - y);
      const close = sorted.length > 1 && sorted[1] - sorted[0] < 0.15;
      const why = stalemate && !timeUp ? 'stalemate' : 'time';
      this.finish({ winner: close ? null : best, method: close ? `draw (${why})` : `decision (${why})`, damage: dmg });
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
