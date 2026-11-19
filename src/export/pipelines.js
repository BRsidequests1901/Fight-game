// Pluggable "AI render" targets. Nothing here calls an external API: each entry
// describes what a pipeline needs, and buildAiKit() packages our data for it.
// Swap or add providers as tools change, without touching the simulation.
import { buildPrompt } from './prompt.js';
import { openPoseFrame } from './openpose.js';

export const AI_PIPELINES = {
  wanPose: {
    name: 'Wan 2.x pose control (VACE / Animate / Fun-Control) in ComfyUI',
    kind: 'open weights, self-hosted or cloud GPU',
    inputs: ['pose control video (Pose view → Record video)', 'text prompt', 'optional reference image per character'],
    notes: 'Most controllable option: the generated motion follows our OpenPose skeleton frame by frame. Free, runs locally on a 24 GB+ GPU or on rented GPUs.',
  },
  klingMotion: {
    name: 'Kling Motion Control (hosted)',
    kind: 'hosted service',
    inputs: ['reference motion video (Pose view or stick-figure video)', 'character reference image', 'text prompt'],
    notes: 'Easiest high-quality hosted option: upload the motion video plus a picture of each character.',
  },
  videoToVideo: {
    name: 'Any video-to-video restyler (Runway, Luma, etc.)',
    kind: 'hosted service',
    inputs: ['stick-figure video (normal view → Record video)', 'text prompt'],
    notes: 'Least precise motion transfer but simplest: restyle the recorded video with the prompt.',
  },
};

/** Snapshot a moving camera so its projection for this frame can be used later. */
export function freezeCamera(cam) {
  return Object.assign(Object.create(Object.getPrototypeOf(cam)), cam);
}

/**
 * Package everything a pose-driven video model needs:
 * prompt + shot list + per-frame OpenPose keypoints for the given camera.
 * `views` is an iterable of { snap, cam } pairs (snapshot + the camera used for that frame).
 */
export function buildAiKit(rec, views, camera, { pipeline = 'wanPose', scene } = {}) {
  const text = buildPrompt(rec, { scene });
  const frames = [];
  for (const { snap, cam } of views) frames.push({ t: Math.round(snap.t * 1000) / 1000, ...openPoseFrame(snap.entities, cam) });
  return {
    format: 'fight-sim-ai-kit',
    version: 1,
    pipeline,
    pipelineInfo: AI_PIPELINES[pipeline],
    fps: rec.fps,
    resolution: { width: Math.round(camera.width), height: Math.round(camera.height) },
    camera: { yaw: camera.yaw, pitch: camera.pitch, distance: camera.dist, target: camera.target, fovDeg: (camera.fov * 180) / Math.PI },
    ...text,
    characters: rec.entities.map((e) => ({ id: e.id, name: e.name, team: rec.teams[e.team].name, style: e.style, species: e.species, heightM: e.scale ?? e.heightM, massKg: e.massKg })),
    openpose: { keypointFormat: 'COCO-18', frames },
    source: { seed: rec.config.seed, config: rec.config, result: rec.result },
  };
}
