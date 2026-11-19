// Rule sets (what ends a fight, what is allowed) and the realism slider.
import { clamp } from './math.js';

export const RULESETS = {
  sport: {
    name: 'Sport',
    description: 'Referee, gloves, padded mat. No hitting a downed fighter (ground strikes only from a grappling position), 10-count. Ends by KO, TKO, submission or decision.',
    gloves: true, hitDowned: false, count: true, surface: 'mat', tapOut: true, surrender: false,
    defaultTimeLimit: 180,
  },
  street: {
    name: 'Street fight',
    description: 'No referee, bare knuckles, hard ground. People on the ground get kicked and stomped. Ends when everyone on a side is unconscious, incapacitated or gives up.',
    gloves: false, hitDowned: true, count: false, surface: 'concrete', tapOut: true, surrender: true,
    defaultTimeLimit: 0,
  },
  pain: {
    name: 'To the pain',
    description: 'A fight to maim, not to kill. Unconsciousness does not end it: the winner keeps going until the loser is crippled (broken limbs). Nobody taps out.',
    gloves: false, hitDowned: true, count: false, surface: 'concrete', tapOut: false, surrender: false, goal: 'maim',
    defaultTimeLimit: 0,
  },
  death: {
    name: 'To the death',
    description: 'No mercy and no surrender: the fight only ends when one side is dead (brain injury, blood loss or strangulation).',
    gloves: false, hitDowned: true, count: false, surface: 'concrete', tapOut: false, surrender: false, goal: 'kill',
    defaultTimeLimit: 0,
  },
};

export const RULE_IDS = Object.keys(RULESETS);

function limbFractures(f) {
  return f.injuries.filter((i) => i.effect === 'leg' || i.effect === 'arm' || i.effect === 'wing').length;
}

/** Why this fighter is out of the fight under these rules (or null). */
export function eliminationReason(f, sim) {
  const r = sim.ruleset;
  if (f.dead) return f.deathCause ? `killed (${f.deathCause})` : 'killed';
  if (r.goal === 'kill') return null;
  if (r.goal === 'maim') {
    const n = limbFractures(f);
    if (n >= 2) return 'maimed';
    if (n >= 1 && (f.consciousness() <= 0.02 || !f.canStand())) return 'maimed';
    if (f.injuries.some((i) => i.effect === 'orbital') && f.consciousness() <= 0.02) return 'maimed (eye)';
    return null;
  }
  const unconscious = f.consciousness() <= 0.02;
  if (f.tapped) return `submission (${f.tapped})`;
  if (unconscious) return f.chokedOut ? 'choked unconscious' : 'KO';
  if (f.yielded) return f.species.humanoid ? 'gives up' : 'flees';
  if (sim.config.rules.mode === 'sport') {
    if (f.countedOut) return 'KO (counted out)';
    if (f.bodyTrauma >= 1) return 'TKO (body)';
    if (!f.canStand()) return 'TKO (cannot stand)';
    const stop = f.injuries.find((i) => i.stop);
    if (stop) return `TKO (doctor stoppage: ${stop.label})`;
    if (sim.config.rules.threeKnockdownRule && f.knockdowns >= 3) return 'TKO (3 knockdowns)';
    if (f.refStopped) return 'TKO (referee stoppage)';
    return null;
  }
  // street
  if (f.bodyTrauma >= 1) return 'incapacitated (body)';
  if (!f.canStand() && f.condition() < 0.5) return 'incapacitated';
  return null;
}

/**
 * Realism slider: 1 = strictly realistic, 0 = action-movie. Movie mode makes
 * fights last longer, knockback bigger, gore lighter, lets the outnumbered hero
 * punch above their weight and makes groups attack a few at a time.
 */
export function applyRealism(sim) {
  const r = clamp(sim.config.rules.realism ?? 1, 0, 1);
  const c = 1 - r;
  sim.realism = r;
  sim.cine = c;
  sim.maxEngaged = r >= 0.95 ? Infinity : 1 + Math.round(r * 4) + (r < 0.5 ? 0 : 1);
  const counts = {};
  for (const f of sim.fighters) counts[f.team] = (counts[f.team] || 0) + 1;
  const total = sim.fighters.length;
  for (const f of sim.fighters) {
    const p = f.phys;
    p.headTol *= 1 + 0.25 * c;
    p.bodyTol *= 1 + 0.25 * c;
    p.legTol *= 1 + 0.25 * c;
    p.aerobic *= 1 + 0.5 * c;
    const allies = counts[f.team];
    const enemies = total - allies;
    const ratio = enemies / Math.max(1, allies);
    if (ratio > 1) {
      const b = c * clamp(Math.log2(ratio), 0, 3); // outnumbered hero
      p.headTol *= 1 + 0.35 * b;
      p.bodyTol *= 1 + 0.35 * b;
      p.staminaCap *= 1 + 0.4 * b;
      p.aerobic *= 1 + 0.4 * b;
      p.defense = Math.min(0.97, p.defense + 0.08 * b);
      p.accuracy = Math.min(0.98, p.accuracy + 0.05 * b);
      p.force *= 1 + 0.25 * b;
      p.speed *= 1 + 0.08 * b;
    } else if (ratio < 1) {
      const b = c * clamp(Math.log2(1 / ratio), 0, 3); // henchmen
      p.headTol *= 1 - 0.15 * b;
      p.bodyTol *= 1 - 0.15 * b;
      p.defense = Math.max(0.05, p.defense - 0.08 * b);
    }
    f.stamina = p.staminaCap;
  }
}
