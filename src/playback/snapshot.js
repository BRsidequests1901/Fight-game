// A snapshot is the renderer-facing description of one moment of a fight.
// Both the live simulation and recorded replays produce snapshots, so any
// renderer works with either.
import { FIXED_DT } from '../sim/simulation.js';

export function vitalsOf(f) {
  return {
    consciousness: f.consciousness(),
    body: 1 - f.bodyTrauma,
    legs: f.canStand() ? 1 - f.legTrauma : 0,
    stamina: f.staminaFrac(),
    blood: Math.max(0, 1 - f.bloodLossFrac() / 0.45),
  };
}

const EFFECT_DURATION = 0.3;

/** Visual impact effects derived from strike events near time t. */
export function effectsAt(events, t) {
  const out = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.t < t - EFFECT_DURATION) break;
    if (e.t > t || e.type !== 'strike' || !e.pos) continue;
    if (e.result !== 'hit' && e.result !== 'blocked' && e.result !== 'checked') continue;
    out.push({
      pos: e.pos,
      kind: e.result === 'hit' ? 'hit' : 'blocked',
      age: t - e.t,
      duration: EFFECT_DURATION,
      strength: Math.min(1, (e.force || 0) / 6000),
    });
  }
  return out;
}

export function snapshotFromSim(sim) {
  const teams = sim.config.teams;
  return {
    t: sim.time,
    over: sim.over,
    result: sim.result,
    arenaRadius: sim.arenaRadius,
    teams: teams.map((t) => ({ name: t.name, color: t.color })),
    entities: sim.fighters.map((f) => ({
      id: f.id,
      name: f.name,
      team: f.team,
      color: teams[f.team].color,
      style: f.style.name,
      species: f.species.id,
      plan: f.plan.id,
      state: f.state,
      role: f.role,
      dead: f.dead,
      outReason: f.outReason,
      headRadius: f.body.headRadius,
      scale: f.body.height,
      facing: f.facing,
      joints: f.plan.pose(f, sim.time),
      vitals: vitalsOf(f),
      injuries: f.injuries.map((i) => i.label),
    })),
    effects: effectsAt(sim.events, sim.time),
  };
}

/** Drives a Simulation in real time with a fixed-step accumulator. */
export class LiveSource {
  constructor(sim, recorder = null, { tail = 3 } = {}) {
    this.sim = sim;
    this.recorder = recorder;
    this.tail = tail;
    this.acc = 0;
    recorder?.capture(sim, true);
  }

  get time() { return this.sim.time; }
  get events() { return this.sim.events; }
  get done() { return this.sim.over && this.sim.time >= this.sim.result.time + this.tail; }

  advance(dt) {
    this.acc += Math.min(dt, 0.5);
    let n = 0;
    while (this.acc >= FIXED_DT && n < 4000) {
      if (this.done) { this.acc = 0; break; }
      this.sim.step(FIXED_DT);
      this.recorder?.capture(this.sim);
      this.acc -= FIXED_DT;
      n++;
    }
    if (this.done) this.recorder?.finish(this.sim);
  }

  snapshot() { return snapshotFromSim(this.sim); }
}
