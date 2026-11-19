// Plays back a baked recording (no simulation needed), with interpolation and seeking.
import { RECORDING_FORMAT, STATE_CODES } from './recorder.js';
import { effectsAt } from './snapshot.js';

export class ReplaySource {
  constructor(rec) {
    if (rec.format !== RECORDING_FORMAT) throw new Error('Not a fight recording file');
    this.rec = rec;
    this.t = 0;
    this.duration = rec.duration;
    this.events = rec.events;
  }

  get time() { return this.t; }
  get done() { return this.t >= this.duration; }

  advance(dt) { this.t = Math.min(this.duration, this.t + dt); }
  seek(t) { this.t = Math.max(0, Math.min(this.duration, t)); }

  snapshot() {
    const { rec } = this;
    const frames = rec.frames;
    const fi = Math.min(frames.length - 1, Math.max(0, Math.floor(this.t * rec.fps)));
    const A = frames[fi];
    const B = frames[Math.min(frames.length - 1, fi + 1)];
    const span = B.t - A.t;
    const k = span > 0 ? Math.max(0, Math.min(1, (this.t - A.t) / span)) : 0;
    const over = rec.result && this.t >= rec.result.time;
    return {
      t: this.t,
      over,
      result: over ? rec.result : null,
      arenaRadius: rec.arenaRadius,
      teams: rec.teams,
      entities: rec.entities.map((meta, i) => {
        const a = A.e[i];
        const b = B.e[i];
        const names = rec.skeletons[meta.plan].joints;
        const joints = {};
        names.forEach((n, ji) => {
          const o = ji * 3;
          joints[n] = {
            x: a.j[o] + (b.j[o] - a.j[o]) * k,
            y: a.j[o + 1] + (b.j[o + 1] - a.j[o + 1]) * k,
            z: a.j[o + 2] + (b.j[o + 2] - a.j[o + 2]) * k,
          };
        });
        return {
          ...meta,
          state: STATE_CODES[a.s],
          outReason: a.o,
          joints,
          vitals: { consciousness: a.v[0], body: a.v[1], legs: a.v[2], stamina: a.v[3] },
        };
      }),
      effects: effectsAt(rec.events, this.t),
    };
  }
}
