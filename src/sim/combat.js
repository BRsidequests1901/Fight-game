// Starting strikes, resolving impacts, and applying biological consequences.
import { TECHNIQUES, techniqueReach, isKick, isHand, techKind, heightBand } from './techniques.js';
import { strikeImpact } from './physiology.js';
import { clamp, sigmoid, wrapAngle } from './math.js';
import { checkFractures, applyBite, addBleed } from './injury.js';
import { eliminationReason } from './rules.js';
import { resolveGrappleAttempt, onBiteLanded, breakLinksOf, tryPin } from './grapple.js';

const BLOCK_CHANCE = { straight: 0.9, hook: 0.75, uppercut: 0.55, claw: 0.7, elbow: 0.7, knee: 0.6, frontKick: 0.85, roundKick: 0.85, sideKick: 0.85, swipe: 0.6, lunge: 0.5, pounce: 0.3, wing: 0.8, bite: 0.6 };
const SLIP_CHANCE = { straight: 0.85, hook: 0.55, claw: 0.6, swipe: 0.6, bite: 0.5, wing: 0.5 };
const GUARD_PATH = { straight: 1, hook: 0.8, uppercut: 0.5, claw: 0.8, elbow: 0.6, knee: 0.4, frontKick: 0.6, roundKick: 0.7, sideKick: 0.6 };

export function regionSurface(target, region) {
  return target.body.surface?.[region] ?? 0.1;
}

/** Regions of the target this technique can physically reach right now. */
export function reachableRegions(f, tech, target) {
  const [lo, hi] = heightBand(f, tech);
  const out = [];
  for (const [r, w] of Object.entries(tech.targets)) {
    const y = target.plan.regionHeight(target, r);
    if (y >= lo && y <= hi) out.push([r, w]);
  }
  return out;
}

export function startAttack(sim, f, techId, target) {
  const tech = TECHNIQUES[techId];
  const rng = sim.rng;
  const goal = sim.ruleset.goal;
  const lying = target.isLying();
  // choose a target region (style weights, going after damaged areas, rule-set goals)
  const regions = reachableRegions(f, tech, target).map(([r, w]) => {
    let weight = w;
    if (r === 'legs') weight *= 1 + target.legTrauma + (goal === 'maim' ? (lying ? 4 : 1.5) : 0);
    if (r === 'body') weight *= 1 + target.bodyTrauma;
    if (r === 'head') weight *= (1 + target.daze) * (goal === 'kill' && lying ? 4 : 1) * (goal === 'maim' && lying ? 0.1 : 1);
    return [r, weight];
  });
  const region = regions.length ? rng.weighted(regions) : Object.keys(tech.targets)[0];
  let limb = tech.limb;
  if (tech.alternate) {
    f.altHand = !f.altHand;
    if (f.altHand) limb = 'rearHand';
    if (f.brokenArms.includes(limb)) limb = limb === 'rearHand' ? 'leadHand' : 'rearHand';
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
  f.spendStamina(4 * 0.5 * mEff * v * v * (tech.cost ?? 1) + (tech.grappleCost || 0) * (f.body.mass / 75));
  f.stats.thrown++;
  sim.emit({ type: 'throw', attacker: f.id, target: target.id, tech: techId, region });
}

export function updateAim(sim, f) {
  const a = f.action;
  const t = sim.byId(a.targetId);
  if (!t) return;
  a.aimDist = Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z);
  if (t.isLying()) {
    // a lying body extends behind its root position; aim at the right part
    const back = { head: 0.85, body: 0.55, legs: 0.1 }[a.region] * t.body.height * (t.body.plan === 'human' ? 1 : 0.5);
    const tx = t.pos.x - Math.cos(t.facing) * back;
    const tz = t.pos.z - Math.sin(t.facing) * back;
    a.aimDist = Math.hypot(tx - f.pos.x, tz - f.pos.z);
  }
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
  if (!tgt || tgt.state === 'out') {
    atk.stats.missed++;
    emitStrike(sim, { ...base, result: 'miss', note: 'nothing there' });
    return;
  }
  const linked = atk.link && atk.link === tgt.link;
  const dx = tgt.pos.x - atk.pos.x;
  const dz = tgt.pos.z - atk.pos.z;
  const d = Math.hypot(dx, dz) || 1e-6;
  const off = Math.abs(wrapAngle(Math.atan2(dz, dx) - atk.facing));
  const reach = techniqueReach(atk, tech);
  const range = tgt.isLying() ? a.aimDist : d;
  if (!linked && (range > reach + regionSurface(tgt, a.region) + 0.05 || off > 0.85)) {
    atk.stats.missed++;
    emitStrike(sim, { ...base, result: 'miss', note: off > 0.85 ? 'off target' : 'out of range' });
    return;
  }
  if (techKind(tech) === 'grapple') {
    resolveGrappleAttempt(sim, atk, tgt, tech, a);
    return;
  }
  const ux = dx / d;
  const uz = dz / d;
  // accuracy vs a moving target
  const lateral = Math.abs(-uz * tgt.vel.x + ux * tgt.vel.z);
  const small = clamp(tgt.body.radius / 0.18, 0.55, 1.3); // small, darting targets are harder to hit
  const acc = atk.phys.accuracy * atk.vision * (0.8 + 0.2 * atk.fatigue()) * (1 - clamp(lateral * 0.12, 0, 0.3))
    * (tgt.state === 'stagger' || tgt.isLying() ? 1.15 : 1) * (0.75 + 0.25 * small) * (linked ? 1.15 : 1);
  if (rng.next() > acc) {
    atk.stats.missed++;
    emitStrike(sim, { ...base, result: 'miss', note: 'misses' });
    return;
  }

  // defense
  let transmit = 1;
  let result = 'hit';
  let armForce = 0;
  const D = tgt.state === 'defend' ? tgt.action : null;
  const canBlock = tgt.species.canBlock && tgt.brokenArms.length < 2;
  if (D) {
    if (D.type === 'block' && canBlock && a.region !== 'legs' && rng.next() < (BLOCK_CHANCE[tech.path] ?? 0.7) * (tgt.brokenArms.length ? 0.6 : 1)) {
      result = 'blocked';
      transmit = isKick(tech) || techKind(tech) === 'strike' ? 0.45 : 0.25;
      armForce = 1 - transmit;
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
      transmit = 0.7;
    }
  } else if (a.region === 'head' && canBlock && (tgt.state === 'ready' || tgt.state === 'attack' || tgt.role === 'bottom')) {
    const cover = (tgt.style.guard?.coverage ?? 0) * tgt.phys.defense * (GUARD_PATH[tech.path] ?? 0.6)
      * (tgt.state === 'attack' ? 0.5 : 1) * tgt.fatigue() * (tgt.role === 'bottom' ? 0.8 : 1);
    if (rng.next() < cover) {
      result = 'blocked';
      transmit = 0.45;
      armForce = 0.55;
    }
  }

  const ev = { ...base, result };
  if (result === 'hit') atk.stats.landed++; else atk.stats.blocked++;
  const pose = tgt.plan.pose(tgt, sim.time);
  const jp = pose[tgt.plan.regionJoint[a.region]] || pose[tgt.plan.headJoint];
  ev.pos = { x: jp.x - ux * 0.05, y: jp.y, z: jp.z - uz * 0.05 };
  sim.lastDamageTime = sim.time;

  if (techKind(tech) === 'bite') {
    if (result === 'hit' || result === 'checked') {
      applyBite(sim, atk, tgt, tech, a.region, ev);
      if (tech.latch) onBiteLanded(sim, atk, tgt, tech, a.region);
    } else {
      ev.force = tech.biteForce * 0.3;
      if (tgt.species.humanoid) {
        addBleed(tgt, tech.cutRate * 0.3 * (1 - 0.7 * sim.cine));
        checkFractures(sim, tgt, 'arm', tech.biteForce * 1.2, 'bite', ev); // bitten on the blocking arm
      }
    }
    emitStrike(sim, ev);
    afterDamage(sim, tgt);
    return;
  }

  // ---- impulse physics
  const v = tech.speed * atk.phys.speed * atk.fatigue();
  const mEff = atk.body.mass * tech.massFrac * atk.phys.transfer * (0.7 + 0.3 * atk.phys.force)
    * (0.85 + 0.15 * atk.fatigue());
  const R = tgt.species.regions[a.region];
  const gloved = sim.ruleset.gloves && isHand(tech);
  const contact = R.contactTime * (gloved ? 1.4 : 1);
  // a body lying on the ground is backed by the floor: nothing gives, the strike's full momentum is absorbed
  const backed = tgt.isLying() ? 6 : 1;
  const imp = strikeImpact({ strikerMass: mEff, velocity: v, targetMass: tgt.body.mass * R.massFrac * backed, contactTime: contact });
  let counter = 1;
  if (tgt.state === 'attack' && tgt.action && !tgt.action.resolved && tgt.action.t > tgt.action.windup * 0.5) {
    counter = 1.2; // walking onto the shot
  }
  const J = imp.impulse * transmit * counter;
  const force = imp.peakForce * transmit * counter;
  Object.assign(ev, { velocity: v, effMass: mEff, impulse: J, force, counter: counter > 1 });

  if (armForce > 0 && tgt.species.humanoid) checkFractures(sim, tgt, 'arm', imp.peakForce * armForce, tech.path, ev);
  if (result === 'hit' || result === 'checked' || transmit >= 0.4) {
    checkFractures(sim, tgt, a.region, force, tech.path, ev, { gloved });
  }
  if (tech.cutRate && result === 'hit') addBleed(tgt, tech.cutRate * (0.6 + 0.8 * rng.next()) * (1 - 0.7 * sim.cine));
  applyHit(sim, atk, tgt, tech, a.region, J, imp.accelG * transmit * counter, ev, ux, uz);
  emitStrike(sim, ev);
  if (tech.pinOnDown && tgt.state === 'down') tryPin(sim, atk, tgt);
  afterDamage(sim, tgt);
}

function applyHit(sim, atk, tgt, tech, region, J, accelG, ev, ux, uz) {
  const rng = sim.rng;
  let stagger = 0;
  const lying = tgt.isLying();
  if (region === 'head') {
    // a head on the floor gets a second impact against the ground and no neck bracing
    // (accelG already uses the floor-backed mass; scale back to head mass, plus the rebound off the floor)
    const floor = lying ? (sim.ruleset.surface === 'mat' ? 1.15 : 1.5) * 3 : 1;
    const g = accelG * tech.headSeverity * floor;
    ev.headG = accelG * floor;
    const tol = tgt.phys.headTol * (1 - 0.35 * tgt.concussion) * (0.9 + 0.1 * tgt.fatigue());
    const ratio = g / tol;
    const inc = 0.3 * ratio ** 2.2;
    tgt.concussion = clamp(tgt.concussion + inc * 0.3, 0, 1);
    tgt.daze = clamp(tgt.daze + inc * 0.7, 0, 1);
    if (ratio > 1.2) tgt.brainInjury = clamp(tgt.brainInjury + 0.3 * (ratio - 1.2) ** 1.3 * (1 - 0.6 * sim.cine), 0, 1);
    if (lying && tgt.consciousness() <= 0.02) tgt.brainInjury = clamp(tgt.brainInjury + 0.04 * ratio * (1 - 0.6 * sim.cine), 0, 1);
    if (ratio > 0.35) stagger = 0.15 + 0.6 * (ratio - 0.35);
    if (tech.cut && ev.result === 'hit') {
      addBleed(tgt, 0.03 * ratio * (sim.ruleset.gloves ? 0.3 : 1) * (1 - 0.7 * sim.cine));
      if (ratio > 0.3) ev.note = 'cut';
    }
    const pKO = sigmoid((ratio - 1) / 0.08);
    ev.koChance = pKO;
    if (rng.next() < pKO && tgt.consciousness() > 0.02) {
      if (ratio > 1.2 || rng.next() < 0.35) {
        ev.note = 'KNOCKOUT';
        tgt.daze = clamp(Math.max(tgt.daze, 1.05 - tgt.concussion - tgt.shock()), 0, 1);
        tgt.koAt = sim.time;
      } else {
        ev.note = 'knockdown';
        tgt.daze = clamp(Math.max(tgt.daze, 0.9 - tgt.concussion), 0, 1);
        if (tgt.isStanding()) knockDown(sim, tgt);
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
    if (rel > 3) addBleed(tgt, 0.05 * (rel - 3) * (1 - 0.7 * sim.cine)); // internal bleeding
  } else {
    const rel = J / (42 * tgt.phys.legTol);
    tgt.legTrauma = clamp(tgt.legTrauma + 0.05 * rel ** 1.6, 0, 1);
    if (rel > 0.8) stagger = 0.1;
  }

  // momentum transfer: push and balance (bigger in movie mode)
  if (!lying) {
    const push = J * tech.knockback * (1 + 1.5 * sim.cine);
    tgt.vel.x += (ux * push * 0.6) / tgt.body.mass;
    tgt.vel.z += (uz * push * 0.6) / tgt.body.mass;
    tgt.balance -= (push / (tgt.body.mass * 2.5 * tgt.stability())) ** 1.5;
  }
  tgt.flinch = Math.min(1, tgt.flinch + J / 40);

  if (stagger > 0 && tgt.isStanding()) {
    if (tgt.state === 'attack' && !tgt.action.resolved) ev.interrupted = true;
    if (tgt.role === 'biter' || tgt.role === 'clinch') breakLinksOf(sim, tgt, 'shaken off');
    if (tgt.link && tgt.role !== 'bitten') return;
    tgt.comboQueue = [];
    tgt.state = 'stagger';
    tgt.action = { kind: 'stagger', t: 0, duration: clamp(stagger, 0.1, 1.5) };
  }
}

/** Re-evaluate a fighter after anything changed: elimination, collapse. */
export function afterDamage(sim, f) {
  if (f.state === 'out') return;
  const reason = eliminationReason(f, sim);
  if (reason) return eliminate(sim, f, reason);
  if (f.isStanding() && !f.link) {
    if (!f.canStand() || f.consciousness() < 0.15 || f.balance <= 0) knockDown(sim, f);
  } else if (f.role === 'bitten' && (!f.canStand() || f.consciousness() < 0.15 || f.balance <= 0)) {
    breakLinksOf(sim, f, 'dragged down');
    knockDown(sim, f);
  }
}

export function knockDown(sim, f) {
  if (f.state === 'down' || f.state === 'out') return;
  breakLinksOf(sim, f, 'knocked down');
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
  const reason = eliminationReason(f, sim);
  if (reason) eliminate(sim, f, reason);
}

export function eliminate(sim, f, reason) {
  if (f.state === 'out') return;
  breakLinksOf(sim, f, 'fight over');
  f.state = 'out';
  f.action = null;
  f.comboQueue = [];
  f.outReason = reason;
  f.choked = false;
  sim.emit({ type: 'out', fighter: f.id, reason });
}

/** Backwards-compatible alias. */
export const setOut = eliminate;
export const checkCollapse = afterDamage;
