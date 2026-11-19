// Records a fight as (1) the config + seed, which re-simulates it exactly on the
// same engine, and (2) a baked per-frame skeleton track that is engine-independent.
// The baked track is the hand-off format for richer renderers, motion retargeting,
// or an AI video pipeline (see README: "Recording format").
import { BODY_PLANS } from '../sim/bodies/index.js';
import { vitalsOf } from './snapshot.js';

export const RECORDING_FORMAT = 'fight-sim-recording';
export const RECORDING_VERSION = 1;
const STATE_CODES = ['ready', 'attack', 'defend', 'stagger', 'down', 'out', 'grapple'];
const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;

export class Recorder {
  constructor(sim, { fps } = {}) {
    const n = sim.fighters.length;
    this.fps = fps ?? (n > 30 ? 10 : n > 8 ? 15 : 30);
    fps = this.fps;
    this.frames = [];
    this.next = 0;
    this.finished = false;
    const plans = new Set(sim.fighters.map((f) => f.plan.id));
    this.header = {
      format: RECORDING_FORMAT,
      version: RECORDING_VERSION,
      fps,
      config: sim.config,
      arenaRadius: sim.arenaRadius,
      teams: sim.config.teams.map((t) => ({ name: t.name, color: t.color })),
      skeletons: Object.fromEntries([...plans].map((id) => {
        const p = BODY_PLANS[id];
        return [id, { joints: p.joints, bones: p.bones, boneWidth: p.boneWidth, headJoint: p.headJoint }];
      })),
      entities: sim.fighters.map((f) => ({
        id: f.id,
        name: f.name,
        team: f.team,
        color: sim.config.teams[f.team].color,
        style: f.style.name,
        styleId: f.styleId,
        species: f.species.id,
        plan: f.plan.id,
        headRadius: r3(f.body.headRadius),
        scale: r3(f.body.height),
        heightM: r3(f.body.height),
        massKg: f.body.mass,
        attrs: f.attrs,
      })),
    };
    this.sim = sim;
  }

  capture(sim, force = false) {
    if (this.finished) return;
    if (!force && sim.time + 1e-9 < this.next) return;
    this.next = sim.time + 1 / this.fps;
    this.frames.push({
      t: r3(sim.time),
      e: sim.fighters.map((f) => {
        const pose = f.plan.pose(f, sim.time);
        const j = [];
        for (const name of f.plan.joints) {
          const p = pose[name];
          j.push(r3(p.x), r3(p.y), r3(p.z));
        }
        const v = vitalsOf(f);
        return {
          s: STATE_CODES.indexOf(f.state),
          f: r2(f.facing),
          j,
          v: [r2(v.consciousness), r2(v.body), r2(v.legs), r2(v.stamina), r2(v.blood)],
          o: f.outReason || undefined,
          d: f.dead ? 1 : undefined,
        };
      }),
    });
  }

  finish(sim) {
    if (this.finished) return;
    this.capture(sim, true);
    this.finished = true;
  }

  toJSON() {
    const sim = this.sim;
    return {
      ...this.header,
      createdAt: new Date().toISOString(),
      duration: this.frames.length ? this.frames[this.frames.length - 1].t : 0,
      result: sim.result,
      stateCodes: STATE_CODES,
      frames: this.frames,
      events: sim.events.filter((e) => e.type !== 'throw'),
      stats: sim.fighters.map((f) => ({ id: f.id, ...f.stats, injuries: f.injuries.map((i) => i.label), dead: f.dead })),
    };
  }
}

export { STATE_CODES };
