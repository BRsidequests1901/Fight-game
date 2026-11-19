// Fighter decision making: target selection, perceiving incoming strikes
// (limited by human reaction time), choosing attacks/combos and footwork.
import { TECHNIQUES, techniqueReach } from './techniques.js';
import { startAttack } from './combat.js';
import { clamp } from './math.js';

export function selectTarget(f, sim) {
  let best = null;
  let bestScore = Infinity;
  for (const o of sim.fighters) {
    if (o.team === f.team || o.state === 'out') continue;
    let score = Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z);
    if (o.state === 'down') score += 5;
    if (o.id === f.targetId) score -= 0.4; // stick with the current opponent
    score -= (1 - o.condition()) * 0.5; // go after hurt opponents
    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best;
}

function techniquesInRange(f, target, d) {
  const out = [];
  for (const [id, w] of Object.entries(f.style.techniques)) {
    const t = TECHNIQUES[id];
    const reach = techniqueReach(f, t) + t.step + target.body.radius * 0.5;
    if (d <= reach && d >= t.minRange) out.push([id, w]);
  }
  return out;
}

export function think(f, sim) {
  const rng = sim.rng;
  f.thinkTimer = 0.09 + rng.next() * 0.09;
  const target = selectTarget(f, sim);
  f.targetId = target ? target.id : null;
  if (!target) { f.intent = { x: 0, z: 0 }; return; }

  const dx = target.pos.x - f.pos.x;
  const dz = target.pos.z - f.pos.z;
  const d = Math.hypot(dx, dz) || 1e-6;
  const ux = dx / d;
  const uz = dz / d;
  const style = f.style;
  const stam = f.staminaFrac();
  const cond = f.condition();

  // ---- attack?
  if (target.state !== 'down') {
    const options = techniquesInRange(f, target, d);
    const aggression = clamp(style.aggression * (0.4 + 0.6 * stam) * (0.5 + 0.5 * cond) + 0.25 * (1 - target.condition()), 0.05, 1);
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
  if (target.state === 'down') desired = 2.2;
  const radial = clamp((d - desired) * 2.5, -1, 1);
  if (rng.next() < 0.04) f.circleDir *= -1;
  const lateral = f.circleDir * style.footwork * 0.55;
  let vx = ux * radial - uz * lateral;
  let vz = uz * radial + ux * lateral;

  // spacing: allies spread out (flanking emerges), keep extra enemies at bay
  for (const o of sim.fighters) {
    if (o === f || o === target || o.state === 'out') continue;
    const ox = f.pos.x - o.pos.x;
    const oz = f.pos.z - o.pos.z;
    const od = Math.hypot(ox, oz) || 1e-6;
    const range = o.team === f.team ? 1.3 : 2.2;
    if (od < range) {
      const k = ((range - od) / range) * (o.team === f.team ? 1.5 : 1.0);
      vx += (ox / od) * k;
      vz += (oz / od) * k;
    }
  }
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
  if (!target || !target.isStanding() || f.staminaFrac() < 0.05) { f.comboQueue = []; return; }
  const d = Math.hypot(target.pos.x - f.pos.x, target.pos.z - f.pos.z);
  const t = TECHNIQUES[next];
  if (d > techniqueReach(f, t) + t.step + 0.3 || d < t.minRange * 0.7) { f.comboQueue = []; return; }
  startAttack(sim, f, next, target);
}

/**
 * Defenders only see a strike after their reaction time has elapsed since it
 * started. If there is still time before impact they may block, slip, check or retreat.
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
    if (def.state !== 'ready') continue; // busy: punching, staggered, down
    const tti = a.impactAt - a.t;
    const tech = TECHNIQUES[a.techId];
    const w = def.style.defense;
    const opts = [];
    if (tti >= 0.05 && a.region !== 'legs') opts.push(['block', w.block]);
    if (a.region === 'head' && ['straight', 'hook', 'claw'].includes(tech.path) && tti >= 0.09) opts.push(['slip', w.slip]);
    if (tti >= 0.12) opts.push(['retreat', w.retreat]);
    if (a.region === 'legs' && tti >= 0.09) opts.push(['check', (w.check || 0) + 0.05]);
    const pAttempt = def.phys.defense * (0.75 + 0.25 * def.staminaFrac()) * (0.6 + 0.4 * def.consciousness());
    if (!opts.length || rng.next() > pAttempt) continue;
    const type = rng.weighted(opts);
    def.state = 'defend';
    def.action = {
      kind: 'defend', type, t: 0, duration: tti + 0.14, attackerId: atk.id,
      region: a.region, slipSide: rng.next() < 0.5 ? -1 : 1,
    };
    def.spendStamina({ block: 80, slip: 150, retreat: 250, check: 120 }[type]);
  }
}
