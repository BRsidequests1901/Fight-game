// Fighter decision making: target selection, perceiving incoming strikes
// (limited by reaction time), choosing attacks/combos/grapples and footwork.
import { TECHNIQUES, techniqueReach, techKind } from './techniques.js';
import { startAttack, reachableRegions, afterDamage } from './combat.js';
import { createLink, grappleSkill, tryPin } from './grapple.js';
import { clamp } from './math.js';

export function selectTarget(f, sim) {
  if (f.role === 'bitten') return sim.byId(f.link.a);
  const hitDowned = sim.ruleset.hitDowned;
  let best = null;
  let bestScore = Infinity;
  for (const o of sim.fighters) {
    if (o.team === f.team || o.state === 'out') continue;
    let score = Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z);
    if (o.isLying()) {
      if (!hitDowned && o.link !== f.link) score += 6;
      else score += sim.ruleset.goal ? 0.6 : 1.2;
    }
    if (o.id === f.targetId) score -= 0.4; // stick with the current opponent
    score -= (1 - o.condition()) * 0.5; // go after hurt opponents
    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/** Techniques this fighter could use on this target right now, with weights. */
export function techniqueOptions(f, target, d, sim) {
  const out = [];
  const consider = { ...f.style.techniques };
  if (f.species.humanoid && !f.link) {
    // anyone can stomp or kick something low (a downed person, a goose)
    consider.stomp = consider.stomp ?? 2;
    consider.soccerKick = consider.soccerKick ?? 1.5;
  }
  for (const [id, w] of Object.entries(consider)) {
    const t = TECHNIQUES[id];
    if (t.requires) continue; // contextual (ground/clinch) moves are chosen by grappleThink
    if (techKind(t) === 'grapple' && !sim.config.rules.grappling) continue;
    if (t.humanoidOnly && !target.species.humanoid) continue;
    if (!f.limbUsable(t)) continue;
    const reach = techniqueReach(f, t) + t.step + target.body.radius * 0.5;
    if (d > reach || d < t.minRange) continue;
    if (!reachableRegions(f, t, target).length) continue;
    out.push([id, w]);
  }
  return out;
}

export function think(f, sim) {
  const rng = sim.rng;
  f.thinkTimer = 0.09 + rng.next() * 0.09;
  const target = selectTarget(f, sim);
  f.targetId = target ? target.id : null;
  if (!target) { f.intent = { x: 0, z: 0 }; return; }

  let dx = target.pos.x - f.pos.x;
  let dz = target.pos.z - f.pos.z;
  const d = Math.hypot(dx, dz) || 1e-6;
  const ux = dx / d;
  const uz = dz / d;
  const style = f.style;
  const stam = f.staminaFrac();
  const cond = f.condition();
  const rules = sim.ruleset;

  // ---- giving up / fleeing (only where the rules allow walking away)
  if (rules.surrender || (f.style.category === 'animal' && !rules.goal)) {
    if (cond < 0.25 && rng.next() < 0.03) {
      f.yielded = true;
      afterDamage(sim, f);
      return;
    }
  }

  // ---- waiting for a turn (movie mode: groups attack a few at a time)
  let waiting = false;
  if (Number.isFinite(sim.maxEngaged)) {
    let closer = 0;
    for (const o of sim.fighters) {
      if (o === f || o.team !== f.team || o.state === 'out' || o.targetId !== target.id) continue;
      if (Math.hypot(o.pos.x - target.pos.x, o.pos.z - target.pos.z) < d) closer++;
    }
    waiting = closer >= sim.maxEngaged;
  }

  const targetDown = target.isLying();
  const mayHit = !targetDown || rules.hitDowned || target.link === f.link;

  // ---- finishing on the ground: mount a downed human, animals pin
  if (targetDown && rules.hitDowned && !waiting && d < 1.3 && !target.link) {
    if (style.grapple?.pin != null && rng.next() < 0.5 && tryPin(sim, f, target)) return;
    if (f.species.humanoid && target.species.humanoid && sim.config.rules.grappling
      && grappleSkill(f, 'top') >= 0.4 && rng.next() < 0.2) {
      createLink(sim, 'ground', f, target, { position: 'mount' });
      sim.emit({ type: 'note', text: '{a} jumps on top of {b}', a: f.id, b: target.id });
      return;
    }
  }

  // ---- attack?
  if (mayHit && !waiting) {
    const options = techniqueOptions(f, target, d, sim);
    const aggression = clamp(style.aggression * (0.4 + 0.6 * stam) * (0.5 + 0.5 * cond) + 0.25 * (1 - target.condition())
      + (targetDown ? 0.3 : 0), 0.05, 1);
    const rate = 1.5 * aggression; // attack initiations per second while in range
    if (options.length && stam > 0.04 && rng.next() < 1 - Math.exp(-rate * 0.135)) {
      const techId = rng.weighted(options);
      f.comboQueue = [];
      if (rng.next() < style.comboRate * (0.5 + 0.5 * stam)) {
        const combos = style.combos.filter((c) => c[0] === techId);
        if (combos.length) f.comboQueue = rng.pick(combos).slice(1);
      }
      startAttack(sim, f, techId, target);
      return;
    }
  }

  // ---- footwork
  const pref = f.preferredDistance();
  let desired = cond < 0.35 || stam < 0.15 ? pref + 0.7 : pref;
  if (targetDown) desired = mayHit ? (f.species.humanoid ? 0.3 : 0.45) * f.body.height : 2.2;
  if (waiting) desired = Math.max(2.4, pref + 1.4);
  if (targetDown && mayHit) {
    // close in on the part of the body we want
    const back = (sim.ruleset.goal === 'maim' ? 0.1 : sim.ruleset.goal === 'kill' ? 0.8 : 0.5) * target.body.height * (target.body.plan === 'human' ? 1 : 0.4);
    dx = target.pos.x - Math.cos(target.facing) * back - f.pos.x;
    dz = target.pos.z - Math.sin(target.facing) * back - f.pos.z;
  }
  const dd = Math.hypot(dx, dz) || 1e-6;
  const vx0 = dx / dd;
  const vz0 = dz / dd;
  const radial = clamp((dd - desired) * 2.5, -1, 1);
  if (rng.next() < 0.04) f.circleDir *= -1;
  const lateral = f.circleDir * style.footwork * (waiting ? 0.8 : 0.55);
  let vx = vx0 * radial - vz0 * lateral;
  let vz = vz0 * radial + vx0 * lateral;

  // spacing: allies spread out (flanking emerges), keep extra enemies at bay
  for (const o of sim.fighters) {
    if (o === f || o === target || o.state === 'out') continue;
    const ox = f.pos.x - o.pos.x;
    const oz = f.pos.z - o.pos.z;
    const od = Math.hypot(ox, oz) || 1e-6;
    const range = o.team === f.team ? Math.max(1.3, (f.body.radius + o.body.radius) * 2.2) : 2.2;
    if (od < range) {
      const k = ((range - od) / range) * (o.team === f.team ? 1.5 : 1.0);
      vx += (ox / od) * k;
      vz += (oz / od) * k;
    }
  }
  void ux; void uz;
  // stay off the arena edge
  const r = Math.hypot(f.pos.x, f.pos.z);
  const edge = sim.arenaRadius - 1.0;
  if (r > edge) {
    vx -= (f.pos.x / r) * (r - edge) * 1.5;
    vz -= (f.pos.z / r) * (r - edge) * 1.5;
  }
  const mag = Math.hypot(vx, vz);
  if (mag > 1) { vx /= mag; vz /= mag; }
  const speed = f.maxMoveSpeed() * (0.45 + 0.4 * style.footwork);
  f.intent = { x: vx * speed, z: vz * speed };
}

/** Continue a queued combination if it still makes sense. */
export function continueCombo(sim, f) {
  if (!f.comboQueue.length || sim.over) return;
  const target = sim.byId(f.targetId);
  const next = f.comboQueue.shift();
  if (!target || target.state === 'out' || f.staminaFrac() < 0.05) { f.comboQueue = []; return; }
  const d = Math.hypot(target.pos.x - f.pos.x, target.pos.z - f.pos.z);
  const opts = techniqueOptions(f, target, d + 0.3, sim);
  if (!opts.some(([id]) => id === next)) { f.comboQueue = []; return; }
  startAttack(sim, f, next, target);
}

/**
 * Defenders only see a strike after their reaction time has elapsed since it
 * started. If there is still time before impact they may block, slip, check,
 * sprawl or retreat.
 */
export function perceiveThreats(sim) {
  const rng = sim.rng;
  for (const atk of sim.fighters) {
    if (atk.state !== 'attack') continue;
    const a = atk.action;
    if (a.resolved || a.perceived) continue;
    const def = sim.byId(a.targetId);
    if (!def || a.t < def.reactionTime()) continue;
    a.perceived = true;
    if (def.state !== 'ready') continue; // busy: striking, staggered, down, grappling
    const tti = a.impactAt - a.t;
    const tech = TECHNIQUES[a.techId];
    const w = def.style.defense;
    const opts = [];
    if (techKind(tech) === 'grapple') {
      if (tti >= 0.1) opts.push(['sprawl', w.sprawl ?? grappleSkill(def, 'tdDefense')]);
      if (tti >= 0.12) opts.push(['retreat', w.retreat]);
    } else {
      if (tti >= 0.05 && a.region !== 'legs' && def.species.canBlock) opts.push(['block', w.block]);
      if (a.region === 'head' && ['straight', 'hook', 'claw', 'swipe', 'bite', 'wing'].includes(tech.path) && tti >= 0.09) opts.push(['slip', w.slip]);
      if (tti >= 0.12) opts.push(['retreat', w.retreat]);
      if (a.region === 'legs' && tti >= 0.09 && def.species.humanoid) opts.push(['check', (w.check || 0) + 0.05]);
    }
    const pAttempt = def.phys.defense * (0.75 + 0.25 * def.staminaFrac()) * (0.6 + 0.4 * def.consciousness());
    if (!opts.length || rng.next() > pAttempt) continue;
    const type = rng.weighted(opts);
    def.state = 'defend';
    def.action = {
      kind: 'defend', type, t: 0, duration: tti + 0.14, attackerId: atk.id,
      region: a.region, slipSide: rng.next() < 0.5 ? -1 : 1,
    };
    def.spendStamina(({ block: 80, slip: 150, retreat: 250, check: 120, sprawl: 300 }[type]) * (def.body.mass / 75));
  }
}
