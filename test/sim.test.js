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

test('every preset finishes (time limit, or the 15-minute cap for open-ended modes)', () => {
  for (const [id, p] of Object.entries(PRESETS)) {
    const seeds = id === 'humanVsGeese' ? 1 : 3;
    for (let seed = 1; seed <= seeds; seed++) {
      const sim = new Simulation({ ...p.config, seed });
      const r = sim.runToEnd();
      assert.ok(r, `${id} seed ${seed} produced no result`);
      const limit = sim.config.rules.timeLimit || 900;
      assert.ok(r.time <= limit + FIXED_DT * 2, `${id} ran past the limit (${r.time})`);
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
    assert.ok(s.attrs && s.height && s.weight, `${id} needs default attributes and size`);
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

const run = (cfg, seed, opts) => {
  const sim = new Simulation({ ...cfg, seed });
  sim.runToEnd(opts);
  return sim;
};

test('to the death only ends in death', () => {
  for (let seed = 1; seed <= 3; seed++) {
    const sim = run(PRESETS.tigerVsThree.config, seed);
    if (sim.result.method.startsWith('decision') || sim.result.method.startsWith('draw')) continue;
    const losers = sim.fighters.filter((f) => f.team !== sim.result.winner);
    assert.ok(losers.every((f) => f.dead), `seed ${seed}: ${sim.result.method}`);
  }
});

test('to the pain ends with a maiming, not a knockout', () => {
  const sim = run(PRESETS.karateVsBrawler.config, 1);
  assert.match(sim.result.method, /maimed|decision|draw/);
  const out = sim.events.filter((e) => e.type === 'out');
  for (const e of out) assert.doesNotMatch(e.reason, /^KO/);
});

test('grappling toggle: takedowns and submissions only happen when enabled', () => {
  const on = PRESETS.wrestlerVsBjj.config;
  let grapples = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const sim = run(on, seed);
    grapples += sim.events.filter((e) => e.type === 'note' && /takes .* down|pulls guard|goes for/.test(e.text)).length;
  }
  assert.ok(grapples > 0, 'expected grappling with the toggle on');
  const off = { ...on, rules: { ...on.rules, grappling: false } };
  for (let seed = 1; seed <= 3; seed++) {
    const sim = run(off, seed);
    assert.equal(sim.events.filter((e) => e.type === 'strike' && TECHNIQUES[e.tech]?.kind === 'grapple').length, 0);
  }
});

test('sport rules: no one strikes a downed fighter unless in a ground position', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const sim = new Simulation({ ...PRESETS.boxerVsMuayThai.config, seed });
    while (!sim.over) {
      sim.step();
      for (const f of sim.fighters) {
        if (f.state === 'attack' && f.action.t < 0.01) {
          const t = sim.byId(f.action.targetId);
          assert.ok(!t.isLying() || f.link === t.link, 'hit a downed fighter in sport mode');
        }
      }
    }
  }
});

test('movie mode makes an outnumbered hero last longer', () => {
  const real = PRESETS.tigerVsFive.config;
  const movie = PRESETS.tigerVsFiveMovie.config;
  let tReal = 0;
  let tMovie = 0;
  for (let seed = 1; seed <= 4; seed++) {
    tReal += run(real, seed).result.time;
    tMovie += run(movie, seed).result.time;
  }
  assert.ok(tMovie > tReal * 1.5, `movie ${tMovie} vs real ${tReal}`);
});

test('animals: all body plans pose with finite joints and keep bone lengths sane', () => {
  const cfg = {
    rules: { mode: 'street' },
    teams: [
      { fighters: [{ style: 'goose', count: 3 }, { style: 'dog' }] },
      { fighters: [{ style: 'bengalTiger' }, { style: 'grizzly' }, { style: 'boxing' }] },
    ],
  };
  const sim = new Simulation({ ...cfg, seed: 4 });
  for (let i = 0; i < 120 * 30 && !sim.over; i++) {
    sim.step();
    for (const f of sim.fighters) {
      const J = f.plan.pose(f, sim.time);
      for (const [k, p] of Object.entries(J)) assert.ok(Number.isFinite(p.x + p.y + p.z), `${f.name} ${k}`);
    }
  }
});

test('a human beats one goose almost every time; a tiger beats a human', () => {
  let humanWins = 0;
  let tigerWins = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const g = run({ rules: { mode: 'street' }, teams: [{ fighters: [{ style: 'brawler' }] }, { fighters: [{ style: 'goose' }] }] }, seed);
    if (g.result.winner === 0) humanWins++;
    const t = run({ rules: { mode: 'street' }, teams: [{ fighters: [{ style: 'mma' }] }, { fighters: [{ style: 'bengalTiger' }] }] }, seed);
    if (t.result.winner === 1) tigerWins++;
  }
  assert.ok(humanWins >= 5, `human beat the goose ${humanWins}/6`);
  assert.ok(tigerWins >= 5, `tiger won ${tigerWins}/6`);
});

test('AI kit: prompt, shots and OpenPose frames for every recorded frame', async () => {
  const { buildAiKit, freezeCamera } = await import('../src/export/pipelines.js');
  const { Camera } = await import('../src/render/camera.js');
  const sim = new Simulation({ ...base, seed: 3, rules: { timeLimit: 10 } });
  const rec = new Recorder(sim);
  const live = new LiveSource(sim, rec, { tail: 0.5 });
  while (!live.done) live.advance(0.5);
  const data = JSON.parse(JSON.stringify(rec.toJSON()));
  const src = new ReplaySource(data);
  const cam = new Camera();
  cam.setViewport(1280, 720);
  const views = [];
  for (let t = 0; t <= src.duration; t += 1 / data.fps) {
    src.seek(t);
    const snap = src.snapshot();
    cam.follow(snap.entities, t === 0 ? 10 : 1 / data.fps);
    views.push({ snap, cam: freezeCamera(cam) });
  }
  const kit = buildAiKit(data, views, cam);
  assert.match(kit.prompt, /Boxing|Muay Thai/);
  assert.equal(kit.openpose.frames.length, views.length);
  const kp = kit.openpose.frames[5].people[0].pose_keypoints_2d;
  assert.equal(kp.length, 18 * 3);
  assert.ok(kp[0] > 0 && kp[0] < 1280 && kp[1] > 0 && kp[1] < 720, 'nose projects on screen');
});
