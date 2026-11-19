// App controller: wires setup UI, simulation/replay sources, renderer, HUD,
// recording and video capture together.
import { Simulation } from './sim/simulation.js';
import { PRESETS } from './sim/scenario.js';
import { Camera } from './render/camera.js';
import { StickRenderer } from './render/stickRenderer.js';
import { BACKGROUNDS } from './render/backgrounds.js';
import { LiveSource } from './playback/snapshot.js';
import { Recorder } from './playback/recorder.js';
import { ReplaySource } from './playback/replay.js';
import { renderTeams, hydrateTeams, fighterFromStyle } from './ui/setup.js';
import { Hud, fmtTime } from './ui/hud.js';
import { RULESETS } from './sim/rules.js';
import { buildAiKit, AI_PIPELINES, freezeCamera } from './export/pipelines.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- setup state
const state = {
  seed: randomSeed(),
  mode: 'sport',
  realism: 1,
  grappling: false,
  timeLimit: 180,
  threeKD: true,
  background: 'dojo',
  teams: hydrateTeams([
    { name: 'Red', fighters: [fighterFromStyle('boxing', 'Boxer')] },
    { name: 'Blue', fighters: [fighterFromStyle('muayThai', 'Nak Muay')] },
  ]),
};

function randomSeed() { return Math.floor(Math.random() * 1e9); }

function buildConfig() {
  return {
    seed: state.seed,
    rules: { mode: state.mode, realism: state.realism, grappling: state.grappling, timeLimit: state.timeLimit, threeKnockdownRule: state.threeKD },
    arena: { background: state.background },
    teams: state.teams.map((t) => ({ name: t.name, color: t.color, fighters: t.fighters.map((f) => ({ ...f })) })),
  };
}

function syncSetupInputs() {
  $('mode').value = state.mode;
  $('modeDesc').textContent = RULESETS[state.mode].description;
  $('threeKD').disabled = state.mode !== 'sport';
  $('realism').value = String(Math.round(state.realism * 100));
  $('realismOut').value = `${Math.round(state.realism * 100)}%`;
  $('grappling').checked = state.grappling;
  $('seed').value = state.seed;
  $('timeLimit').value = String(state.timeLimit);
  $('threeKD').checked = state.threeKD;
  $('background').value = state.background;
  renderTeams($('teams'), state, () => {});
}

for (const [id, p] of Object.entries(PRESETS)) $('preset').append(new Option(p.label, id));
for (const [id, b] of Object.entries(BACKGROUNDS)) $('background').append(new Option(b.name, id));
for (const [id, r] of Object.entries(RULESETS)) $('mode').append(new Option(r.name, id));
$('mode').addEventListener('change', (e) => {
  state.mode = e.target.value;
  state.timeLimit = RULESETS[state.mode].defaultTimeLimit;
  syncSetupInputs();
});
$('realism').addEventListener('input', (e) => {
  state.realism = Number(e.target.value) / 100;
  $('realismOut').value = `${e.target.value}%`;
});
$('grappling').addEventListener('change', (e) => { state.grappling = e.target.checked; });
$('preset').addEventListener('change', (e) => {
  const p = PRESETS[e.target.value];
  if (!p) return;
  state.teams = hydrateTeams(p.config.teams);
  const r = p.config.rules || {};
  state.mode = r.mode || 'sport';
  state.timeLimit = r.timeLimit ?? RULESETS[state.mode].defaultTimeLimit;
  state.threeKD = r.threeKnockdownRule ?? true;
  state.grappling = !!r.grappling;
  state.realism = r.realism ?? 1;
  syncSetupInputs();
});
$('seed').addEventListener('input', (e) => { state.seed = Math.max(0, Math.floor(Number(e.target.value) || 0)); });
$('reseed').addEventListener('click', () => { state.seed = randomSeed(); $('seed').value = state.seed; });
$('timeLimit').addEventListener('change', (e) => { state.timeLimit = Number(e.target.value); });
$('threeKD').addEventListener('change', (e) => { state.threeKD = e.target.checked; });
$('background').addEventListener('change', (e) => { state.background = e.target.value; });
$('start').addEventListener('click', () => startLive(buildConfig()));
$('loadRec').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const rec = JSON.parse(await file.text());
    if (rec.frames?.length) startReplay(rec);
    else if (rec.config) startLive(rec.config); // seed-only file: re-simulate
    else throw new Error('no frames or config in file');
  } catch (err) {
    alert(`Could not load recording: ${err.message}`);
  }
  e.target.value = '';
});
syncSetupInputs();

// ---------------------------------------------------------------- arena
const canvas = $('canvas');
const camera = new Camera();
const renderer = new StickRenderer(canvas, camera);
const hud = new Hud($('hud'), $('log'));
const app = { source: null, recorder: null, config: null, paused: false, speed: 1, mode: null, names: [], lastHud: 0, video: null };

function showArena() {
  $('setup').classList.add('hidden');
  $('arena').classList.remove('hidden');
  renderer.resize();
}

function begin(source, background) {
  app.source = source;
  app.paused = false;
  $('pause').textContent = '⏸ Pause';
  renderer.background = background || 'dojo';
  showArena();
  camera.auto = true;
  camera.zoom = 1;
  const snap = source.snapshot();
  app.names = snap.entities.map((e) => e.name);
  hud.reset(snap);
  camera.follow(snap.entities, 10);
  $('banner').classList.add('hidden');
}

function startLive(config) {
  stopVideo();
  const sim = new Simulation(config);
  app.mode = 'live';
  app.config = config;
  app.recorder = new Recorder(sim);
  begin(new LiveSource(sim, app.recorder), config.arena?.background);
  $('scrub').classList.add('hidden');
  $('restart').classList.remove('hidden');
  $('newSeed').classList.remove('hidden');
  $('saveRec').classList.remove('hidden');
}

function startReplay(rec) {
  stopVideo();
  const src = new ReplaySource(rec);
  app.mode = 'replay';
  app.config = rec.config;
  app.recorder = null;
  begin(src, rec.config?.arena?.background);
  const scrub = $('scrub');
  scrub.max = String(src.duration);
  scrub.value = '0';
  scrub.classList.remove('hidden');
  $('saveRec').classList.add('hidden');
}

$('back').addEventListener('click', () => {
  stopVideo();
  app.source = null;
  $('arena').classList.add('hidden');
  $('setup').classList.remove('hidden');
});
$('pause').addEventListener('click', () => {
  app.paused = !app.paused;
  $('pause').textContent = app.paused ? '▶ Play' : '⏸ Pause';
});
$('speed').addEventListener('change', (e) => { app.speed = Number(e.target.value); });
$('restart').addEventListener('click', () => {
  if (app.mode === 'replay') { app.source.seek(0); return; }
  startLive(app.config);
});
$('newSeed').addEventListener('click', () => {
  state.seed = randomSeed();
  $('seed').value = state.seed;
  startLive({ ...app.config, seed: state.seed });
});
$('saveRec').addEventListener('click', () => {
  if (!app.recorder) return;
  const data = app.recorder.toJSON();
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `fight-${app.config.seed}.json`);
});
$('poseView').addEventListener('click', () => {
  renderer.mode = renderer.mode === 'openpose' ? 'stick' : 'openpose';
  $('poseView').classList.toggle('on', renderer.mode === 'openpose');
});
$('aiKit').addEventListener('click', () => {
  const rec = app.mode === 'replay' ? app.source.rec : JSON.parse(JSON.stringify(app.recorder.toJSON()));
  // re-play the recording through a camera that frames it the same way as the view
  const src = new ReplaySource(rec);
  const cam = new Camera();
  cam.setViewport(camera.width, camera.height);
  Object.assign(cam, { yaw: camera.yaw, pitch: camera.pitch, zoom: camera.zoom });
  const views = [];
  const dt = 1 / rec.fps;
  for (let t = 0; t <= src.duration + 1e-9; t += dt) {
    src.seek(t);
    const snap = src.snapshot();
    cam.follow(snap.entities, t === 0 ? 10 : dt);
    views.push({ snap, cam: freezeCamera(cam) });
  }
  const kit = buildAiKit(rec, views, cam, { pipeline: 'wanPose' });
  kit.alternatives = AI_PIPELINES;
  download(new Blob([JSON.stringify(kit)], { type: 'application/json' }), `fight-${rec.config.seed}-ai-kit.json`);
});
$('scrub').addEventListener('input', (e) => { if (app.mode === 'replay') app.source.seek(Number(e.target.value)); });
$('recVideo').addEventListener('click', () => (app.video ? stopVideo() : startVideo()));

// camera interaction: one finger / mouse drag orbits, two-finger pinch or wheel zooms
const pointers = new Map();
let pinchDist = 0;
let lastTap = 0;
const pinchSpan = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* not all pointers can be captured */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) pinchDist = pinchSpan();
  if (e.pointerType === 'touch' && pointers.size === 1) {
    if (e.timeStamp - lastTap < 300) resetCamera();
    lastTap = e.timeStamp;
  }
});
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const cur = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, cur);
  if (pointers.size === 1) {
    camera.orbit(-(cur.x - prev.x) * 0.006, (cur.y - prev.y) * 0.004);
  } else if (pointers.size === 2) {
    const d = pinchSpan();
    if (pinchDist > 0) camera.zoom = Math.max(0.3, Math.min(4, camera.zoom * (d / pinchDist)));
    pinchDist = d;
  }
});
const endPointer = (e) => { pointers.delete(e.pointerId); pinchDist = pointers.size === 2 ? pinchSpan() : 0; };
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.zoom = Math.max(0.3, Math.min(4, camera.zoom * Math.exp(-e.deltaY * 0.001)));
}, { passive: false });
function resetCamera() { camera.yaw = 0.3; camera.pitch = 0.28; camera.zoom = 1; }
canvas.addEventListener('dblclick', resetCamera);
window.addEventListener('resize', () => { if (app.source) renderer.resize(); });

// ---------------------------------------------------------------- video capture
function startVideo() {
  if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
    alert('Video recording is not supported in this browser.');
    return;
  }
  const stream = canvas.captureStream(30);
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find((t) => MediaRecorder.isTypeSupported(t));
  const mr = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined);
  const chunks = [];
  mr.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  mr.onstop = () => {
    const blob = new Blob(chunks, { type: mr.mimeType || 'video/webm' });
    const ext = (mr.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
    download(blob, `fight-${app.config?.seed ?? 'replay'}.${ext}`);
  };
  mr.start(250);
  app.video = mr;
  $('recVideo').textContent = '⏹ Stop recording';
  $('recVideo').classList.add('rec');
}

function stopVideo() {
  if (!app.video) return;
  app.video.stop();
  app.video = null;
  $('recVideo').textContent = '⏺ Record video';
  $('recVideo').classList.remove('rec');
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const src = app.source;
  if (src) {
    if (!app.paused) src.advance(dt * app.speed);
    const snap = src.snapshot();
    if (camera.auto) camera.follow(snap.entities, dt);
    renderer.render(snap);
    $('clock').textContent = fmtTime(snap.t);
    if (now - app.lastHud > 100) {
      app.lastHud = now;
      hud.update(snap);
      hud.log(src.events, snap.t, app.names);
      if (app.mode === 'replay') $('scrub').value = String(snap.t);
    }
    const banner = $('banner');
    if (snap.over && snap.result) {
      const r = snap.result;
      const who = r.winner == null ? 'No winner' : `${snap.teams[r.winner].name} wins`;
      banner.textContent = `${who} — ${r.method} at ${fmtTime(r.time)}`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// installable app: offline support (skipped on localhost so development always loads fresh files)
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// expose for debugging / automation
window.fightSim = { app, state, startLive, startReplay, camera };
