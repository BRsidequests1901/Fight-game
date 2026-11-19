// OpenPose (COCO-18) keypoints: the de-facto control format for pose-guided
// image/video models (ControlNet-OpenPose, Wan VACE / Animate pose control,
// AnimateDiff, etc.). We derive them from our 3D skeleton and a camera.
export const COCO18 = [
  'nose', 'neck', 'rShoulder', 'rElbow', 'rWrist', 'lShoulder', 'lElbow', 'lWrist',
  'rHip', 'rKnee', 'rAnkle', 'lHip', 'lKnee', 'lAnkle', 'rEye', 'lEye', 'rEar', 'lEar',
];

export const LIMBS = [
  [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10],
  [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17],
];

export const COLORS = [
  [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0],
  [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255],
  [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85],
];

/** 3D COCO-18 keypoints for a human entity from a snapshot. */
export function keypoints3D(e) {
  const J = e.joints;
  const r = e.headRadius;
  const fx = Math.cos(e.facing ?? 0);
  const fz = Math.sin(e.facing ?? 0);
  const rx = -fz;
  const rz = fx;
  const h = J.head;
  const at = (a, s, up) => ({ x: h.x + fx * a + rx * s, y: h.y + up, z: h.z + fz * a + rz * s });
  return [
    at(r * 0.95, 0, -0.1 * r), J.neck, J.rShoulder, J.rElbow, J.rHand, J.lShoulder, J.lElbow, J.lHand,
    J.rHip, J.rKnee, J.rAnkle, J.lHip, J.lKnee, J.lAnkle,
    at(r * 0.75, r * 0.35, 0.25 * r), at(r * 0.75, -r * 0.35, 0.25 * r), at(0, r * 0.95, 0.1 * r), at(0, -r * 0.95, 0.1 * r),
  ];
}

/** One frame in OpenPose JSON layout (pixel coordinates for this camera). */
export function openPoseFrame(entities, cam) {
  const people = [];
  for (const e of entities) {
    if (e.plan !== 'human') continue;
    const kp = [];
    for (const p of keypoints3D(e)) {
      const s = cam.project(p);
      if (s) kp.push(Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10, 1);
      else kp.push(0, 0, 0);
    }
    people.push({ person_id: [e.id], pose_keypoints_2d: kp });
  }
  return { version: 1.3, people };
}

/** Draw an OpenPose-style control image (black background, standard colors). */
export function drawOpenPose(ctx, cam, entities, getPlan) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cam.width, cam.height);
  ctx.lineCap = 'round';
  for (const e of entities) {
    if (e.plan !== 'human') {
      // non-human: plain grey stick skeleton (use a depth/canny control for animals)
      const plan = getPlan(e.plan);
      ctx.strokeStyle = 'rgba(200,200,200,0.8)';
      ctx.lineWidth = 3;
      for (const [a, b] of plan.bones) {
        const pa = cam.project(e.joints[a]);
        const pb = cam.project(e.joints[b]);
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      continue;
    }
    const pts = keypoints3D(e).map((p) => cam.project(p));
    const w = Math.max(3, (pts[1]?.s ?? 100) * 0.035);
    LIMBS.forEach(([a, b], i) => {
      if (!pts[a] || !pts[b]) return;
      const [r, g, bl] = COLORS[i];
      ctx.strokeStyle = `rgba(${r},${g},${bl},0.6)`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
      ctx.stroke();
    });
    pts.forEach((p, i) => {
      if (!p) return;
      const [r, g, bl] = COLORS[i];
      ctx.fillStyle = `rgb(${r},${g},${bl})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, w * 0.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
