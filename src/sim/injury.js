// Injuries beyond "damage": bone fractures, bleeding, brain injury, strangulation
// and death. Numbers are approximate and meant to land in plausible ranges:
//  - fracture forces: nasal bone ~0.5-1 kN, mandible ~2-4 kN, ribs ~3 kN, tibia ~4-7 kN
//  - blood volume ~70 ml/kg; unconscious around 30-35% loss, fatal around 40-45%
//  - blood choke: unconscious in ~8-12 s; sustained strangulation is fatal
import { clamp, sigmoid } from './math.js';

const EFFECTS = {
  nose(f) { addBleed(f, 0.04); f.daze = clamp(f.daze + 0.05, 0, 1); },
  jaw(f) { f.daze = clamp(f.daze + 0.25, 0, 1); addBleed(f, 0.02); return { stop: true }; },
  orbital(f) { f.vision *= 0.75; return { stop: true }; },
  skull(f) { f.brainInjury = clamp(f.brainInjury + 0.35, 0, 1); addBleed(f, 0.1); f.daze = clamp(f.daze + 0.3, 0, 1); },
  ribs(f) { f.bodyTrauma = clamp(f.bodyTrauma + 0.12, 0, 1); f.aerobicMult *= 0.8; },
  leg(f) { f.brokenLegs++; },
  arm(f, rng) {
    const free = ['leadHand', 'rearHand'].filter((h) => !f.brokenArms.includes(h));
    if (free.length) f.brokenArms.push(free[Math.floor(rng.next() * free.length)]);
  },
  wing(f) { f.brokenWings++; },
};

export function addBleed(f, litersPerMin) {
  f.bleedRate += Math.max(0, litersPerMin);
}

function threshold(f, def, sim) {
  return def.thr * f.species.boneMult * (f.body.mass / 75) ** (2 / 3) * (1 + sim.cine);
}

// How concentrated the striking surface is (a shin spreads force over a big area; an elbow tip doesn't)
const FOCUS = { roundKick: 0.6, frontKick: 0.8, sideKick: 0.8, soccer: 0.8, knee: 0.9, elbow: 1.2, groundStrike: 1.1, swipe: 0.9, wing: 1, bite: 1, lunge: 0.4, pounce: 0.4 };

/** Roll for broken bones from a force applied to a region. */
export function checkFractures(sim, f, region, force, path, ev, { gloved = false } = {}) {
  const list = f.species.fractures[region] || [];
  force *= FOCUS[path] ?? 1;
  const found = [];
  for (const def of list) {
    if (def.paths && !def.paths.includes(path)) continue;
    if (f.injuries.some((i) => i.id === def.id) && def.effect !== 'leg' && def.effect !== 'arm') continue;
    const thr = threshold(f, def, sim) * (gloved ? 1.8 : 1);
    const p = def.chance * sigmoid((force - thr) / (0.08 * thr));
    if (sim.rng.next() < p) {
      const extra = EFFECTS[def.effect]?.(f, sim.rng) || {};
      const inj = { id: def.id, label: def.label, effect: def.effect, t: sim.time, ...extra };
      f.injuries.push(inj);
      found.push(inj);
      sim.emit({ type: 'note', text: `{a} suffers a ${def.label}`, a: f.id, big: true });
    }
  }
  if (found.length && ev) ev.injuries = found.map((i) => i.label);
  return found;
}

/** Bite: crushing force, tearing (bleeding), possibly fatal on the neck. */
export function applyBite(sim, atk, tgt, tech, region, ev) {
  const rng = sim.rng;
  const F = tech.biteForce * (atk.body.mass / { goose: 4.5, dog: 35, tiger: 200, bear: 270 }[atk.species.id] || 1) ** (2 / 3)
    * (0.85 + 0.15 * atk.fatigue());
  ev.force = F;
  const sizeK = clamp(F / 1000, 0.05, 6);
  const neck = region === 'head' && tgt.species.humanoid;
  const bleed = tech.cutRate * sizeK * (neck ? 3 : region === 'body' ? 0.7 : 1) * (0.6 + 0.8 * rng.next()) * (1 - 0.7 * sim.cine);
  addBleed(tgt, bleed);
  tgt.spendStamina(F * 0.4); // pain
  tgt.flinch = Math.min(1, tgt.flinch + sizeK * 0.3);
  if (region === 'head') tgt.daze = clamp(tgt.daze + 0.03 * sizeK, 0, 1);
  if (region === 'legs') tgt.legTrauma = clamp(tgt.legTrauma + 0.04 * sizeK / tgt.phys.legTol, 0, 1);
  if (region === 'body') tgt.bodyTrauma = clamp(tgt.bodyTrauma + 0.02 * sizeK / tgt.phys.bodyTol, 0, 1);
  // crushing bones: bites concentrate force on small areas
  const fracRegion = region === 'head' ? 'head' : region === 'legs' ? 'legs' : (tgt.species.humanoid && rng.next() < 0.5 ? 'arm' : 'body');
  checkFractures(sim, tgt, fracRegion, F * 1.6, 'bite', ev);
  if (neck && tech.lethalNeck && rng.next() < sigmoid((F - 3000) / 600) * 0.35 * (1 - sim.cine)) {
    tgt.brainInjury = 1; // crushed cervical spine / throat
    tgt.deathCause = 'neck bite';
    ev.note = 'neck crushed';
  }
  ev.bleed = bleed;
  if (!ev.note && bleed > 0.15) ev.note = 'deep bite';
}

/** Per-step biology: bleeding, shock, strangulation, death. */
export function updateInjuries(sim, f, dt) {
  if (f.dead) return;
  if (f.bleedRate > 0) {
    f.bloodLost += (f.bleedRate / 60) * dt;
    // small wounds clot over a couple of minutes; big ones barely
    const clot = f.bleedRate < 0.3 ? dt / 150 : dt / 900;
    f.bleedRate = Math.max(0, f.bleedRate * (1 - clot));
  }
  if (f.choked) {
    f.hypoxia = clamp(f.hypoxia + dt / 9, 0, 1);
    if (f.hypoxia >= 1) f.anoxia = clamp(f.anoxia + dt / sim.lethalChokeTime, 0, 1);
  } else {
    f.hypoxia = Math.max(0, f.hypoxia - dt / 6);
  }
  const loss = f.bloodLost / f.bloodVolume;
  if (f.brainInjury >= 1) die(sim, f, f.deathCause || 'brain injury');
  else if (loss >= 0.45) die(sim, f, 'blood loss');
  else if (f.anoxia >= 1) die(sim, f, 'strangled');
}

export function die(sim, f, cause) {
  if (f.dead) return;
  f.dead = true;
  f.deathCause = cause;
  sim.emit({ type: 'note', text: `{a} is dead (${cause})`, a: f.id, big: true });
}

/** Directly inflict an injury (e.g. a joint lock breaking a limb). */
export function inflictInjury(sim, f, effect, label) {
  const extra = EFFECTS[effect]?.(f, sim.rng) || {};
  f.injuries.push({ id: effect, label, effect, t: sim.time, ...extra });
  sim.emit({ type: 'note', text: `{a} suffers a ${label}`, a: f.id, big: true });
}
