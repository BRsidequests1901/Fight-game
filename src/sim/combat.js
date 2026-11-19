// Starting strikes, resolving impacts, and applying biological consequences.
import { TECHNIQUES, techniqueReach, isKick } from './techniques.js';
import { REGIONS, strikeImpact } from './physiology.js';
import { clamp, sigmoid, wrapAngle } from './math.js';

const BLOCK_CHANCE = { straight: 0.9, hook: 0.75, uppercut: 0.55, claw: 0.7, elbow: 0.7, knee: 0.6, frontKick: 0.85, roundKick: 0.85, sideKick: 0.85 };
const SLIP_CHANCE = { straight: 0.85, hook: 0.55, claw: 0.6 };
const GUARD_PATH = { straight: 1, hook: 0.8, uppercut: 0.5, claw: 0.8, elbow: 0.6, knee: 0.4, frontKick: 0.6, roundKick: 0.7, sideKick: 0.6 };

export function regionSurface(target, region) {
  if (region === 'head') return 0.055 * target.body.height;
  if (region === 'body') return target.body.radius * 0.9;
  return 0.06 * target.body.height;
}

export function startAttack(sim, f, techId, target) {
  const tech = TECHNIQUES[techId];
  const rng = sim.rng;
  // choose a target region (style weights, plus going after damaged areas)
  const regions = Object.entries(tech.targets).map(([r, w]) => {
    let weight = w;
    if (r === 'legs') weight *= 1 + target.legTrauma;
    if (r === 'body') weight *= 1 + target.bodyTrauma;
    if (r === 'head') weight *= 1 + target.daze;
    return [r, weight];
  });
  const region = rng.weighted(regions);
  let limb = tech.limb;
  if (tech.alternate) {
    f.altHand = !f.altHand;
    if (f.altHand) limb = 'rearHand';
  }
  const sp = f.phys.speed * f.fatigue();
  const windup = (tech.windup * f.phys.telegraph) / sp;
  const active = tech.active / sp;
  const recovery = (tech.recovery / sp) * (1 + 0.3 * (1 - f.staminaFrac()));
  f.state = 'attack';
  f.action = {
    kind: 'attack', techId, limb, region, targetId: target.id,
    t: 0, windup, active, recovery, impactAt: windup + active, total: windup + active + recovery,
    resolved: false, perceived: false, aimDist: 1, aimHeight: 1.5,
  };
  updateAim(sim, f);
  const v = tech.speed * f.phys.speed * f.fatigue();
  const mEff = f.body.mass * tech.massFrac;
  f.spendStamina(4 * 0.5 * mEff * v * v * (tech.cost ?? 1));
  f.stats.thrown++;
  sim.emit({ type: 'throw', attacker: f.id, target: target.id, tech: techId, region });
}

export function updateAim(sim, f) {
  const a = f.action;
  const t = sim.byId(a.targetId);
  if (!t) return;
  a.aimDist = Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z);
  a.aimHeight = t.plan.regionHeight(t, a.region);
}

function emitStrike(sim, ev) {
  sim.emit({ type: 'strike', ...ev });
}

export function resolveStrike(sim, atk, a) {
  const tech = TECHNIQUES[a.techId];
  const tgt = sim.byId(a.targetId);
  const rng = sim.rng;
  const base = { attacker: atk.id, target: a.targetId, tech: a.techId, region: a.region };
  if (!tgt || !tgt.isStanding()) {
    atk.stats.missed++;
    emitStrike(sim, { ...base, result: 'miss', note: 'nothing there' });
    return;
  }
  const dx = tgt.pos.x - atk.pos.x;
  const dz = tgt.pos.z - atk.pos.z;
  const d = Math.hypot(dx, dz);
  const off = Math.abs(wrapAngle(Math.atan2(dz, dx) - atk.facing));
  const reach = techniqueReach(atk, tech);
  if (d > reach + regionSurface(tgt, a.region) || off > 0.8) {
    atk.stats.missed++;
    emitStrike(sim, { ...base, result: 'miss', note: off > 0.8 ? 'off target' : 'out of range' });
    return;
  }
  // accuracy vs a moving target
  const ux = dx / d;
  const uz = dz / d;
  const lateral = Math.abs(-uz * tgt.vel.x + ux * tgt.vel.z);
  const acc = atk.phys.accuracy * (0.8 + 0.2 * atk.fatigue()) * (1 - clamp(lateral * 0.12, 0, 0.3))
    * (tgt.state === 'stagger' ? 1.1 : 1);
  if (rng.next() > acc) {
    atk.stats.missed++;
    emitStrike(sim, { ...base, result: 'miss', note: 'misses' });
    return;
  }

  // defense
  let transmit = 1;
  let result = 'hit';
  const D = tgt.state === 'defend' ? tgt.action : null;
  if (D) {
    if (D.type === 'block' && a.region !== 'legs' && rng.next() < (BLOCK_CHANCE[tech.path] ?? 0.7)) {
      result = 'blocked';
      transmit = isKick(tech) ? 0.45 : 0.25;
    } else if (D.type === 'slip' && a.region === 'head'
      && rng.next() < (SLIP_CHANCE[tech.path] ?? 0.2) * (0.8 + 0.02 * tgt.attrs.dexterity)) {
      atk.stats.missed++;
      emitStrike(sim, { ...base, result: 'slipped', note: 'slipped' });
      return;
    } else if (D.type === 'check' && a.region === 'legs' && rng.next() < 0.85) {
      result = 'checked';
      transmit = 0.2;
      atk.legTrauma = clamp(atk.legTrauma + 0.04 / atk.phys.legTol, 0, 1); // shin into knee
    } else if (D.type === 'retreat') {
      transmit = 0.7; // moving away bleeds off some of the impact
    }
  } else if (a.region === 'head' && (tgt.state === 'ready' || tgt.state === 'attack')) {
    const cover = tgt.style.guard.coverage * tgt.phys.defense * (GUARD_PATH[tech.path] ?? 0.6)
      * (tgt.state === 'attack' ? 0.5 : 1) * tgt.fatigue();
    if (rng.next() < cover) {
      result = 'blocked';
      transmit = 0.45;
    }
  }

  // physics
  const v = tech.speed * atk.phys.speed * atk.fatigue();
  const mEff = atk.body.mass * tech.massFrac * atk.phys.transfer * (0.7 + 0.3 * atk.phys.force)
    * (0.85 + 0.15 * atk.fatigue());
  const R = REGIONS[a.region];
  const imp = strikeImpact({ strikerMass: mEff, velocity: v, targetMass: tgt.body.mass * R.massFrac, contactTime: R.contactTime });
  let counter = 1;
  if (tgt.state === 'attack' && tgt.action && !tgt.action.resolved && tgt.action.t > tgt.action.windup * 0.5) {
    counter = 1.2; // walking onto the shot
  }
  const J = imp.impulse * transmit * counter;
  const ev = {
    ...base, result, velocity: v, effMass: mEff,
    impulse: J, force: imp.peakForce * transmit * counter, counter: counter > 1,
  };
  if (result === 'hit') atk.stats.landed++; else atk.stats.blocked++;
  const pose = tgt.plan.pose(tgt, sim.time);
  const jp = pose[tgt.plan.regionJoint[a.region]];
  ev.pos = { x: jp.x - ux * 0.05, y: jp.y, z: jp.z - uz * 0.05 };
  applyHit(sim, atk, tgt, tech, a.region, J, imp.accelG * transmit * counter, ev, ux, uz);
  emitStrike(sim, ev);
  if (tgt.state !== 'out') checkCollapse(sim, tgt);
}

function applyHit(sim, atk, tgt, tech, region, J, accelG, ev, ux, uz) {
  const rng = sim.rng;
  let stagger = 0;
  if (region === 'head') {
    const g = accelG * tech.headSeverity;
    ev.headG = accelG;
    const tol = tgt.phys.headTol * (1 - 0.35 * tgt.concussion) * (0.9 + 0.1 * tgt.fatigue());
    const ratio = g / tol;
    const inc = 0.3 * ratio ** 2.2;
    tgt.concussion = clamp(tgt.concussion + inc * 0.3, 0, 1);
    tgt.daze = clamp(tgt.daze + inc * 0.7, 0, 1);
    if (ratio > 0.35) stagger = 0.15 + 0.6 * (ratio - 0.35);
    if (tech.cut && ev.result === 'hit') {
      tgt.bleed = clamp(tgt.bleed + 0.04 * ratio, 0, 1);
      if (ratio > 0.3) ev.note = 'cut';
    }
    const pKO = sigmoid((ratio - 1) / 0.08);
    ev.koChance = pKO;
    if (rng.next() < pKO) {
      if (ratio > 1.2 || rng.next() < 0.35) {
        ev.note = 'KNOCKOUT';
        setOut(sim, tgt, 'KO');
      } else {
        // flash knockdown: badly rocked but not unconscious
        ev.note = 'knockdown';
        tgt.daze = clamp(Math.max(tgt.daze, 0.9 - tgt.concussion), 0, 1);
        knockDown(sim, tgt);
        return;
      }
    }
  } else if (region === 'body') {
    const rel = J / (38 * tgt.phys.bodyTol);
    tgt.bodyTrauma = clamp(tgt.bodyTrauma + 0.025 * rel ** 1.6, 0, 1);
    tgt.spendStamina(J * 25);
    if (rel > 0.6) stagger = 0.1 + 0.3 * (rel - 0.6);
    if (tech.liver && ev.result === 'hit' && rng.next() < sigmoid((rel - 1.3) / 0.15) * 0.5) {
      ev.note = 'liver shot';
      tgt.spendStamina(tgt.phys.staminaCap * 0.3);
      tgt.bodyTrauma = clamp(tgt.bodyTrauma + 0.1, 0, 1);
      stagger = 1.2;
    }
  } else {
    const rel = J / (42 * tgt.phys.legTol);
    tgt.legTrauma = clamp(tgt.legTrauma + 0.05 * rel ** 1.6, 0, 1);
    if (rel > 0.8) stagger = 0.1;
  }

  // momentum transfer: push and balance
  const push = J * tech.knockback;
  tgt.vel.x += (ux * push * 0.6) / tgt.body.mass;
  tgt.vel.z += (uz * push * 0.6) / tgt.body.mass;
  tgt.balance -= (push / (tgt.body.mass * 2.5 * tgt.stability())) ** 1.5;
  tgt.flinch = Math.min(1, tgt.flinch + J / 40);

  if (tgt.state === 'out') return;
  if (stagger > 0) {
    if (tgt.state === 'attack' && !tgt.action.resolved) ev.interrupted = true;
    tgt.comboQueue = [];
    tgt.state = 'stagger';
    tgt.action = { kind: 'stagger', t: 0, duration: clamp(stagger, 0.1, 1.5) };
  }
}

export function checkCollapse(sim, f) {
  if (!f.isStanding()) return;
  if (f.consciousness() <= 0.02) return setOut(sim, f, 'KO');
  if (f.bodyTrauma >= 1) return setOut(sim, f, 'TKO (body)');
  if (f.legTrauma >= 1) return setOut(sim, f, 'TKO (legs)');
  if (f.balance <= 0 || f.consciousness() < 0.15) knockDown(sim, f);
}

export function knockDown(sim, f) {
  f.state = 'down';
  f.action = null;
  f.comboQueue = [];
  f.knockdowns++;
  f.stats.knockdowns++;
  f.downTimer = 0;
  f.rising = false;
  f.balance = 0;
  f.getUpAt = 2 + 6 * (1 - f.consciousness()) + sim.rng.next() * 2;
  sim.emit({ type: 'knockdown', fighter: f.id, count: f.knockdowns });
  if (sim.config.rules.threeKnockdownRule && f.knockdowns >= 3) setOut(sim, f, 'TKO (3 knockdowns)');
}

export function setOut(sim, f, reason) {
  if (f.state === 'out') return;
  f.state = 'out';
  f.action = null;
  f.comboQueue = [];
  f.outReason = reason;
  sim.emit({ type: 'out', fighter: f.id, reason });
}
