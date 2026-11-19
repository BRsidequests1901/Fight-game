// Grappling and other "links" between two bodies: clinch, ground positions
// (guard / mount / back, animal pins), submissions, and bites that latch on.
import { TECHNIQUES } from './techniques.js';
import { clamp, sigmoid } from './math.js';
import { applyBite, inflictInjury } from './injury.js';
import { startAttack } from './combat.js';

const SUBS = {
  mount: [['arm-triangle choke', 'choke'], ['armbar', 'armlock']],
  back: [['rear-naked choke', 'choke']],
  guardBottom: [['triangle choke', 'choke'], ['armbar', 'armlock'], ['guillotine', 'choke'], ['heel hook', 'leglock']],
};

export function grappleSkill(f, key) {
  return f.style.grapple?.[key] ?? 0.25;
}

function power(f) {
  return (0.6 + 0.4 * f.phys.force) * (f.body.mass / 75) ** 0.8 * f.fatigue() * (0.4 + 0.6 * f.consciousness());
}

/** Probability that A wins a grappling exchange against D. */
export function contest(a, aKey, d, dKey, bonus = 1) {
  const A = grappleSkill(a, aKey) * power(a) * bonus;
  const D = grappleSkill(d, dKey) * power(d);
  return (A * A) / (A * A + D * D + 1e-9);
}

const other = (sim, link, f) => sim.byId(link.a === f.id ? link.b : link.a);

export function createLink(sim, kind, a, b, extra = {}) {
  breakLinksOf(sim, a, null);
  breakLinksOf(sim, b, null);
  const link = { id: sim.nextLinkId++, kind, a: a.id, b: b.id, t: 0, idle: 0, sub: null, shakeT: 0, ...extra };
  sim.links.push(link);
  a.link = link;
  b.link = link;
  if (kind === 'clinch') {
    a.role = 'clinch';
    b.role = 'clinch';
    for (const f of [a, b]) { f.state = 'grapple'; f.action = null; f.comboQueue = []; }
  } else if (kind === 'ground') {
    a.role = 'top';
    b.role = 'bottom';
    for (const f of [a, b]) { f.state = 'grapple'; f.action = null; f.comboQueue = []; }
    b.fallT = Math.max(b.fallT, 0.3);
  } else if (kind === 'bite') {
    a.role = 'biter';
    b.role = 'bitten';
    a.state = 'grapple';
    a.action = null;
  }
  for (const f of [a, b]) f.thinkTimer = 0.2 + sim.rng.next() * 0.2;
  updateLinkViews(sim, link);
  return link;
}

export function breakLink(sim, link, reason) {
  const i = sim.links.indexOf(link);
  if (i < 0) return;
  sim.links.splice(i, 1);
  for (const id of [link.a, link.b]) {
    const f = sim.byId(id);
    const wasBottom = f.role === 'bottom';
    f.link = null;
    f.role = null;
    f.linkView = null;
    f.choked = false;
    if (f.state === 'grapple' || (f.state === 'attack' && TECHNIQUES[f.action?.techId]?.requires)) {
      if (wasBottom) {
        f.state = 'down';
        f.action = null;
        f.downTimer = 0;
        f.rising = false;
        f.noCount = true;
        f.getUpAt = 0.4 + sim.rng.next() * 0.6;
      } else {
        f.state = 'ready';
        f.action = null;
      }
    }
    f.thinkTimer = 0.15;
  }
  if (reason) sim.emit({ type: 'note', text: `{a} and {b}: ${reason}`, a: link.a, b: link.b });
}

export function breakLinksOf(sim, f, reason) {
  if (f.link) breakLink(sim, f.link, reason);
}

/** A slam onto the ground (takedowns, throws). Head impact depends on the surface. */
function slam(sim, f, k) {
  const rng = sim.rng;
  const breakfall = clamp(grappleSkill(f, 'escape'), 0, 1);
  const g = (sim.ruleset.surface === 'mat' ? 22 : 55) * k * (0.5 + 0.9 * rng.next()) * (1 - 0.5 * breakfall);
  const ratio = g / f.phys.headTol;
  const inc = 0.3 * ratio ** 2.2;
  f.concussion = clamp(f.concussion + inc * 0.3, 0, 1);
  f.daze = clamp(f.daze + inc * 0.7, 0, 1);
  if (rng.next() < sigmoid((ratio - 1) / 0.08)) {
    f.daze = clamp(1.05 - f.concussion, 0, 1);
    sim.emit({ type: 'note', text: '{a} is knocked out by the impact with the ground', a: f.id, big: true });
  }
  if (ratio > 1.2) f.brainInjury = clamp(f.brainInjury + 0.3 * (ratio - 1.2), 0, 1);
  f.spendStamina(1500 * k * (f.body.mass / 75));
  f.bodyTrauma = clamp(f.bodyTrauma + 0.03 * k / f.phys.bodyTol, 0, 1);
  return g;
}

export function resolveGrappleAttempt(sim, atk, tgt, tech, a) {
  const rng = sim.rng;
  const ev = { type: 'strike', attacker: atk.id, target: tgt.id, tech: a.techId, region: a.region };
  if (tech.humanoidOnly && !tgt.species.humanoid) {
    sim.emit({ ...ev, result: 'miss', note: 'nothing to grab' });
    return;
  }
  const sprawl = tgt.state === 'defend' && tgt.action?.type === 'sprawl';
  const shaken = tgt.state === 'stagger' ? 1.3 : 1;
  sim.lastDamageTime = sim.time;
  switch (tech.grapple) {
    case 'takedown': {
      let p = contest(atk, 'takedown', tgt, 'tdDefense', sprawl ? 0.6 : 1) * shaken * (1 + 0.5 * (1 - tgt.balance));
      if (atk.link?.kind === 'clinch') p *= 1.25;
      if (rng.next() < clamp(p, 0.02, 0.95)) {
        const g = slam(sim, tgt, 1);
        createLink(sim, 'ground', atk, tgt, { position: rng.next() < 0.65 ? 'guard' : 'mount' });
        sim.emit({ ...ev, result: 'hit', note: 'takedown', headG: g });
        sim.emit({ type: 'note', text: `{a} takes {b} down (${atk.link.position})`, a: atk.id, b: tgt.id, big: true });
      } else {
        sim.emit({ ...ev, result: 'blocked', note: sprawl ? 'sprawled on' : 'takedown stuffed' });
        atk.state = 'stagger';
        atk.action = { kind: 'stagger', t: 0, duration: 0.35 };
        if (sprawl) atk.spendStamina(1000);
      }
      break;
    }
    case 'clinch': {
      const p = contest(atk, 'clinch', tgt, 'clinch', 1.4) * shaken;
      if (rng.next() < p) {
        createLink(sim, 'clinch', atk, tgt);
        sim.emit({ ...ev, result: 'hit', note: 'clinch' });
      } else {
        sim.emit({ ...ev, result: 'blocked', note: 'clinch broken' });
      }
      break;
    }
    case 'throw': {
      if (atk.link?.kind !== 'clinch') { sim.emit({ ...ev, result: 'miss', note: 'no grip' }); break; }
      const p = contest(atk, 'throw', tgt, 'tdDefense') * shaken;
      if (rng.next() < p) {
        const g = slam(sim, tgt, 1.6);
        sim.emit({ ...ev, result: 'hit', note: 'thrown', headG: g });
        if (grappleSkill(atk, 'top') > 0.55) {
          createLink(sim, 'ground', atk, tgt, { position: 'mount' });
          sim.emit({ type: 'note', text: '{a} throws {b} and follows to the ground', a: atk.id, b: tgt.id, big: true });
        } else {
          breakLink(sim, atk.link, null);
          tgt.state = 'down';
          tgt.action = null;
          tgt.downTimer = 0;
          tgt.noCount = true;
          tgt.getUpAt = 1 + rng.next();
          sim.emit({ type: 'note', text: '{a} throws {b} to the ground', a: atk.id, b: tgt.id, big: true });
        }
      } else {
        sim.emit({ ...ev, result: 'blocked', note: 'throw defended' });
      }
      break;
    }
    case 'guardPull': {
      if (atk.link?.kind !== 'clinch') break;
      createLink(sim, 'ground', tgt, atk, { position: 'guard' });
      sim.emit({ type: 'note', text: '{a} pulls guard on {b}', a: atk.id, b: tgt.id });
      break;
    }
    default:
      break;
  }
}

export function onBiteLanded(sim, atk, tgt, tech, region) {
  if (atk.link || tgt.link || atk.state === 'out') return;
  if (sim.rng.next() < tech.latch * atk.fatigue()) {
    createLink(sim, 'bite', atk, tgt, { biteRegion: region, biteTech: tech });
    sim.emit({ type: 'note', text: `{a} latches onto {b}'s ${region === 'legs' ? 'leg' : region === 'body' ? 'arm' : 'neck'}`, a: atk.id, b: tgt.id, big: true });
  }
}

/** Big animals pin a downed opponent and maul. */
export function tryPin(sim, atk, tgt) {
  if (atk.link || tgt.link || !grappleSkill(atk, 'pin') || tgt.state !== 'down') return false;
  if (atk.style.grapple?.pin == null) return false;
  createLink(sim, 'ground', atk, tgt, { position: 'pin' });
  sim.emit({ type: 'note', text: '{a} pins {b} to the ground', a: atk.id, b: tgt.id, big: true });
  return true;
}

function headPoint(f) {
  const H = f.body.height;
  if (f.isLying()) {
    const back = (f.body.plan === 'human' ? 0.85 : 0.4) * H;
    return { x: f.pos.x - Math.cos(f.facing) * back, y: 0.08 * H, z: f.pos.z - Math.sin(f.facing) * back };
  }
  const fwd = f.role === 'top' ? 0.15 * H : 0.03 * H;
  return { x: f.pos.x + Math.cos(f.facing) * fwd, y: f.plan.regionHeight(f, 'head'), z: f.pos.z + Math.sin(f.facing) * fwd };
}

function chestPoint(f) {
  const H = f.body.height;
  if (f.isLying()) {
    const back = (f.body.plan === 'human' ? 0.55 : 0.1) * H;
    return { x: f.pos.x - Math.cos(f.facing) * back, y: 0.12 * H, z: f.pos.z - Math.sin(f.facing) * back };
  }
  return { x: f.pos.x, y: f.plan.regionHeight(f, 'body'), z: f.pos.z };
}

function updateLinkViews(sim, link) {
  const A = sim.byId(link.a);
  const B = sim.byId(link.b);
  for (const [f, o] of [[A, B], [B, A]]) {
    f.linkView = {
      kind: link.kind,
      role: f.role,
      position: link.position,
      sub: link.sub?.type || null,
      subBy: link.sub?.by ?? null,
      partnerHead: headPoint(o),
      partnerChest: chestPoint(o),
      bitePoint: link.bitePoint || null,
    };
  }
}

function placeLinked(sim, link) {
  const A = sim.byId(link.a);
  const B = sim.byId(link.b);
  if (link.kind === 'clinch') {
    const mx = (A.pos.x + B.pos.x) / 2;
    const mz = (A.pos.z + B.pos.z) / 2;
    let ux = B.pos.x - A.pos.x;
    let uz = B.pos.z - A.pos.z;
    const d = Math.hypot(ux, uz) || 1;
    ux /= d; uz /= d;
    const dist = (A.body.radius + B.body.radius) * 1.05;
    A.pos = { x: mx - (ux * dist) / 2, z: mz - (uz * dist) / 2 };
    B.pos = { x: mx + (ux * dist) / 2, z: mz + (uz * dist) / 2 };
    A.facing = Math.atan2(uz, ux);
    B.facing = Math.atan2(-uz, -ux);
    A.vel = { x: 0, z: 0 };
    B.vel = { x: 0, z: 0 };
  } else if (link.kind === 'ground') {
    B.vel = { x: 0, z: 0 };
    A.vel = { x: 0, z: 0 };
    const back = (B.body.plan === 'human' ? 0.5 : 0.15) * B.body.height + (A.body.plan === 'human' ? 0 : -A.body.length * 0.1);
    A.pos = { x: B.pos.x - Math.cos(B.facing) * back, z: B.pos.z - Math.sin(B.facing) * back };
    A.facing = B.facing + Math.PI;
    if (A.body.plan !== 'human') A.facing = B.facing + Math.PI * 0.5; // animals stand across the body
  } else if (link.kind === 'bite') {
    let ux = A.pos.x - B.pos.x;
    let uz = A.pos.z - B.pos.z;
    const d = Math.hypot(ux, uz) || 1;
    ux /= d; uz /= d;
    const dist = B.body.radius + A.body.reach.jaw * 0.75;
    A.pos = { x: B.pos.x + ux * dist, z: B.pos.z + uz * dist };
    A.facing = Math.atan2(-uz, -ux);
    A.vel = { ...B.vel };
    const y = B.plan.regionHeight(B, link.biteRegion === 'head' ? 'head' : link.biteRegion === 'legs' ? 'legs' : 'body');
    link.bitePoint = { x: B.pos.x + ux * B.body.radius * 0.8, y: Math.min(y, A.body.height * 1.6), z: B.pos.z + uz * B.body.radius * 0.8 };
  }
  updateLinkViews(sim, link);
}

export function tickLinks(sim, dt) {
  for (const link of [...sim.links]) {
    const A = sim.byId(link.a);
    const B = sim.byId(link.b);
    link.t += dt;
    if (A.state === 'out' || B.state === 'out' || A.consciousness() <= 0.02 || A.dead || B.dead) {
      breakLink(sim, link, null);
      continue;
    }
    if (link.kind === 'clinch' && B.consciousness() <= 0.02) { breakLink(sim, link, null); continue; }
    placeLinked(sim, link);
    const sport = sim.config.rules.mode === 'sport';
    if (link.kind === 'clinch' && sport && link.t > 5) { breakLink(sim, link, 'the referee breaks the clinch'); continue; }
    if (link.kind === 'ground' && sport && link.t > 45) { breakLink(sim, link, 'the referee stands them up'); continue; }
    if (link.kind === 'bite') {
      link.shakeT += dt;
      if (link.shakeT > 0.6) {
        link.shakeT = 0;
        const ev = { type: 'strike', attacker: A.id, target: B.id, tech: link.biteTech ? Object.keys(TECHNIQUES).find((k) => TECHNIQUES[k] === link.biteTech) : 'dogBite', region: link.biteRegion, result: 'hit', note: 'shakes' };
        applyBite(sim, A, B, { ...link.biteTech, biteForce: link.biteTech.biteForce * 0.5, cutRate: link.biteTech.cutRate * 0.5 }, link.biteRegion, ev);
        B.balance -= 0.5 * (A.body.mass / B.body.mass) ** 0.8;
        sim.emit(ev);
        sim.lastDamageTime = sim.time;
      }
      if (sim.rng.next() < dt / 4 || A.condition() < 0.4) { breakLink(sim, link, 'lets go'); continue; }
    }
    if (link.sub) tickSub(sim, link, dt);
  }
}

function tickSub(sim, link, dt) {
  const sub = link.sub;
  const att = sim.byId(sub.by);
  const def = other(sim, link, att);
  const rng = sim.rng;
  sub.t += dt;
  sub.roll = (sub.roll || 0) + dt;
  const tick = sub.roll >= 0.5;
  if (tick) sub.roll = 0;
  att.spendStamina(120 * dt * (att.body.mass / 75));
  def.spendStamina(160 * dt * (def.body.mass / 75));
  const conscious = def.consciousness() > 0.02;
  if (!sub.locked) {
    sub.progress += dt * 0.45 * (0.2 + 0.6 * grappleSkill(att, "submission") - 0.3 * grappleSkill(def, "escape") * def.fatigue())
      * att.fatigue() * (sub.name === 'rear-naked choke' ? 1.4 : 1) * (conscious ? 1 : 5);
    if (tick && conscious && rng.next() < 0.12 * grappleSkill(def, 'escape') * def.fatigue()) {
      sim.emit({ type: 'note', text: `{a} escapes the ${sub.name}`, a: def.id });
      link.sub = null;
      return;
    }
    if (sub.progress >= 1) {
      sub.locked = true;
      sub.lockedAt = sub.t;
      sim.emit({ type: 'note', text: `{a} locks in the ${sub.name}`, a: att.id, big: true });
    }
    return;
  }
  const r = sim.ruleset;
  if (sub.type === 'choke') {
    def.choked = true;
    if (tick && conscious && r.tapOut && def.consciousness() > 0.2 && rng.next() < 0.45) {
      def.tapped = sub.name;
      def.choked = false;
      sim.emit({ type: 'note', text: `{a} taps to the ${sub.name}`, a: def.id, big: true });
      return;
    }
    if (!conscious) {
      def.chokedOut = true;
      if (r.goal === 'maim') { // keep them alive: switch to breaking a limb
        def.choked = false;
        link.sub = { type: 'armlock', name: 'armbar', by: att.id, progress: 1, locked: true, t: 0, lockedAt: 0 };
      }
    }
  } else {
    // joint lock: tap, or the joint gives way
    if (tick && conscious && r.tapOut && rng.next() < 0.55) {
      def.tapped = sub.name;
      sim.emit({ type: 'note', text: `{a} taps to the ${sub.name}`, a: def.id, big: true });
      return;
    }
    if (sub.t - sub.lockedAt > 1.2 || !conscious) {
      inflictInjury(sim, def, sub.type === 'leglock' ? 'leg' : 'arm', sub.type === 'leglock' ? `knee destroyed (${sub.name})` : `broken arm (${sub.name})`);
      link.sub = null;
    }
  }
}

function startSub(sim, link, f, name, type) {
  link.sub = { name, type, by: f.id, progress: 0, locked: false, t: 0 };
  sim.emit({ type: 'note', text: `{a} goes for a ${name}`, a: f.id });
}

/** Decision making while in a link. */
export function grappleThink(f, sim) {
  const rng = sim.rng;
  f.thinkTimer = 0.25 + rng.next() * 0.3;
  const link = f.link;
  if (!link) { f.state = 'ready'; return; }
  const o = other(sim, link, f);
  const st = f.style;
  const grapplingOn = sim.config.rules.grappling;
  const has = (id) => st.techniques[id] != null && f.limbUsable(TECHNIQUES[id]);
  const plan = st.groundPlan || (st.category === 'animal' ? 'maul' : 'pound');
  const opts = [];
  if (f.role === 'clinch') {
    if (has('knee') || grappleSkill(f, 'clinch') >= 0.6) opts.push(['knee', 2 * grappleSkill(f, 'clinch')]);
    if (has('rearElbow')) opts.push(['rearElbow', 1]);
    if (has('uppercut')) opts.push(['uppercut', 0.8]);
    if (grapplingOn && (has('hipThrow') || grappleSkill(f, 'throw') >= 0.5)) opts.push(['hipThrow', 3 * grappleSkill(f, 'throw')]);
    if (grapplingOn && grappleSkill(f, 'takedown') >= 0.6) opts.push(['doubleLeg', 2 * grappleSkill(f, 'takedown')]);
    if (grapplingOn && has('guardPull')) opts.push(['guardPull', 1.5]);
    opts.push(['@break', grappleSkill(f, 'clinch') < 0.5 ? 2.5 : 0.7]);
  } else if (f.role === 'top') {
    const out = o.consciousness() <= 0.02;
    const goal = sim.ruleset.goal;
    if (st.category === 'animal') {
      for (const [id, w] of Object.entries(st.techniques)) if (TECHNIQUES[id].maul) opts.push([id, w]);
    } else {
      opts.push(['groundPunch', plan === 'pound' ? 3 : 1.5]);
      if (f.limbUsable(TECHNIQUES.groundElbow)) opts.push(['groundElbow', plan === 'pound' ? 1.2 : 0.6]);
      if (!link.sub) {
        const subs = SUBS[link.position] || [];
        const sw = plan === 'submit' ? 3 : plan === 'mixed' ? 1.5 : 0.4;
        for (const [name, type] of subs) opts.push([`@sub:${name}:${type}`, sw * grappleSkill(f, 'submission') * (goal === 'maim' && type === 'armlock' ? 4 : 1)]);
        if (link.position === 'guard') opts.push(['@advance', 1.5 * grappleSkill(f, 'top')]);
        if (link.position === 'mount') opts.push(['@advance', 0.6 * grappleSkill(f, 'top')]);
        if (!out && st.category !== 'grappling' && grappleSkill(f, 'top') < 0.5) opts.push(['@standup', 1.5]);
      } else {
        opts.push(['@hold', 4]);
      }
      if (out && goal === 'maim' && !link.sub) opts.push(['@sub:armbar:armlock', 6]);
    }
  } else if (f.role === 'bottom') {
    if (f.consciousness() <= 0.05) return;
    const top = o;
    if (!f.species.humanoid) {
      opts.push(['@escape', 1]);
    } else {
      opts.push(['upPunch', 1]);
      opts.push(['@escape', st.category === 'grappling' ? 1 : 2.5]);
      opts.push(['@sweep', 1.5 * grappleSkill(f, 'bottom')]);
      if (link.position === 'guard' && !link.sub && top.species.humanoid) {
        for (const [name, type] of SUBS.guardBottom) opts.push([`@sub:${name}:${type}`, 2.5 * grappleSkill(f, 'submission') ** 2]);
      }
    }
  } else if (f.role === 'biter') {
    if (f.condition() < 0.4) breakLink(sim, link, 'lets go');
    return;
  }
  const valid = opts.filter(([id]) => id.startsWith('@') || (TECHNIQUES[id] && f.limbUsable(TECHNIQUES[id])));
  if (!valid.length) return;
  const choice = rng.weighted(valid);
  if (!choice.startsWith('@')) {
    if (TECHNIQUES[choice].requires === 'clinch' && f.role !== 'clinch') return;
    startAttack(sim, f, choice, o);
    return;
  }
  if (choice === '@hold') return;
  if (choice === '@break' || choice === '@standup') {
    if (rng.next() < contest(f, 'escape', o, f.role === 'clinch' ? 'clinch' : 'bottom') + 0.2) breakLink(sim, link, f.role === 'clinch' ? 'break apart' : 'back to the feet');
    return;
  }
  if (choice === '@escape') {
    const key = o.style.grapple?.pin != null ? 'pin' : 'top';
    if (rng.next() < contest(f, 'escape', o, key) * 0.6) breakLink(sim, link, `${f.name} escapes`);
    f.spendStamina(600);
    return;
  }
  if (choice === '@sweep') {
    if (rng.next() < contest(f, 'bottom', o, 'top') * 0.5) {
      breakLink(sim, link, null);
      createLink(sim, 'ground', f, o, { position: 'mount' });
      o.fallT = 1;
      sim.emit({ type: 'note', text: '{a} sweeps {b} and takes mount', a: f.id, b: o.id, big: true });
    }
    f.spendStamina(500);
    return;
  }
  if (choice === '@advance') {
    if (rng.next() < contest(f, 'top', o, 'bottom') * 0.7) {
      link.position = link.position === 'guard' ? 'mount' : 'back';
      sim.emit({ type: 'note', text: `{a} advances to ${link.position === 'back' ? 'the back' : 'mount'}`, a: f.id });
    }
    return;
  }
  if (choice.startsWith('@sub:')) {
    const [, name, type] = choice.split(':');
    startSub(sim, link, f, name, type);
  }
}

