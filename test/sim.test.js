import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, FIXED_DT } from '../src/sim/simulation.js';
import { PRESETS } from '../src/sim/scenario.js';
import { strikeImpact } from '../src/sim/physiology.js';
import { STYLES } from '../src/sim/styles.js';
import { TECHNIQUES } from '../src/sim/techniques.js';
import { Recorder } from '../src/playback/recorder.js';
import { ReplaySource } from '../src/playback/replay.js';
import { LiveSource } from '../src/playback/snapshot.js';

const base = PRESETS.boxerVsMuayThai.config;
const fingerprint = (sim) => JSON.stringify(sim.events.map((e) => [e.type, e.t.toFixed(4), e.tech, e.result, e.attacker]));

test('same seed reproduces the exact same fight', () => {
  const a = new Simulation({ ...base, seed: 42 });
  const b = new Simulation({ ...base, seed: 42 });
  a.runToEnd();
  b.runToEnd();
  assert.equal(fingerprint(a), fingerprint(b));
  assert.deepEqual(a.result, b.result);
});

test('different seeds produce different fights', () => {
  const a = new Simulation({ ...base, seed: 1 });
  const b = new Simulation({ ...base, seed: 2 });
  a.runToEnd();
  b.runToEnd();
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test('every preset finishes within its time limit', () => {
  for (const [id, p] of Object.entries(PRESETS)) {
    for (let seed = 1; seed <= 5; seed++) {
      const sim = new Simulation({ ...p.config, seed });
      const r = sim.runToEnd();
      assert.ok(r, `${id} seed ${seed} produced no result`);
      assert.ok(r.time <= sim.config.rules.timeLimit + FIXED_DT * 2, `${id} ran past the limit`);
    }
  }
});

test('strike physics are in the measured human range', () => {
  // trained boxer's cross to the head: literature ~2-5 kN, ~40-90 g
  const mass = 75;
  const t = TECHNIQUES.cross;
  const imp = strikeImpact({ strikerMass: mass * t.massFrac * 0.92, velocity: t.speed, targetMass: mass * 0.081, contactTime: 0.012 });
  assert.ok(imp.peakForce > 2000 && imp.peakForce < 6000, `cross force ${imp.peakForce}`);
  assert.ok(imp.accelG > 35 && imp.accelG < 110, `cross head accel ${imp.accelG}`);
  // a jab is clearly lighter than a cross, a roundhouse kick heavier
  const jab = strikeImpact({ strikerMass: mass * TECHNIQUES.jab.massFrac, velocity: TECHNIQUES.jab.speed, targetMass: 6, contactTime: 0.012 });
  const kick = strikeImpact({ strikerMass: mass * TECHNIQUES.roundKick.massFrac, velocity: TECHNIQUES.roundKick.speed, targetMass: 6, contactTime: 0.012 });
  assert.ok(jab.impulse < imp.impulse && imp.impulse < kick.impulse);
});

test('all style techniques and combos reference real techniques', () => {
  for (const [id, s] of Object.entries(STYLES)) {
    for (const t of Object.keys(s.techniques)) assert.ok(TECHNIQUES[t], `${id}: ${t}`);
    for (const c of s.combos) for (const t of c) assert.ok(TECHNIQUES[t], `${id} combo: ${t}`);
  }
});

test('groups spawn and stay inside the arena', () => {
  const sim = new Simulation({ ...PRESETS.tigerVsFive.config, seed: 3 });
  assert.equal(sim.fighters.length, 6);
  for (let i = 0; i < 120 * 20; i++) {
    sim.step();
    for (const f of sim.fighters) assert.ok(Math.hypot(f.pos.x, f.pos.z) <= sim.arenaRadius + 1e-6);
  }
});

test('pose keeps limb lengths (IK is consistent)', () => {
  const sim = new Simulation({ ...base, seed: 9 });
  for (let i = 0; i < 120 * 10; i++) {
    sim.step();
    for (const f of sim.fighters) {
      const J = f.plan.pose(f, sim.time);
      const d = (a, b) => Math.hypot(J[a].x - J[b].x, J[a].y - J[b].y, J[a].z - J[b].z);
      assert.ok(Math.abs(d('lShoulder', 'lElbow') - f.body.upperArm) < 1e-6);
      assert.ok(Math.abs(d('rHip', 'rKnee') - f.body.thigh) < 1e-6);
      for (const k of Object.keys(J)) assert.ok(Number.isFinite(J[k].x + J[k].y + J[k].z), `${k} not finite`);
    }
  }
});

test('recording round-trips through JSON and replays the same poses', () => {
  const sim = new Simulation({ ...base, seed: 11, rules: { timeLimit: 20 } });
  const rec = new Recorder(sim, { fps: 30 });
  const live = new LiveSource(sim, rec, { tail: 1 });
  while (!live.done) live.advance(0.25);
  const data = JSON.parse(JSON.stringify(rec.toJSON()));
  const replay = new ReplaySource(data);
  assert.ok(replay.duration > 0);
  const frame = data.frames[Math.floor(data.frames.length / 2)];
  replay.seek(frame.t);
  const snap = replay.snapshot();
  const names = data.skeletons.human.joints;
  snap.entities.forEach((e, i) => {
    names.forEach((n, ji) => {
      assert.ok(Math.abs(e.joints[n].x - frame.e[i].j[ji * 3]) < 1e-3);
    });
  });
  // the recording also holds config + seed, which re-simulates identically
  const again = new Simulation(data.config);
  again.runToEnd({ tail: 1 });
  assert.deepEqual(again.result, sim.result);
});
