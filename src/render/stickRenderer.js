// Stick / line / dot renderer. It only consumes snapshots (see
// playback/snapshot.js), so it can be replaced by a richer renderer
// (sprites, WebGL meshes, AI video) without touching the simulation.
import { BACKGROUNDS } from './backgrounds.js';
import { getBodyPlan } from '../sim/bodies/index.js';
import { drawOpenPose } from '../export/openpose.js';
import { centerOf } from './camera.js';

export class StickRenderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.background = 'dojo';
    this.showLabels = true;
    this.mode = 'stick'; // 'stick' | 'openpose' (AI pose-control view)
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.setViewport(r.width, r.height);
  }

  render(snap) {
    const { ctx, camera: cam } = this;
    if (this.mode === 'openpose') {
      drawOpenPose(ctx, cam, snap.entities.filter((e) => e.state !== 'out' || e.plan === 'human'), getBodyPlan);
      return;
    }
    const bg = BACKGROUNDS[this.background] || BACKGROUNDS.dojo;
    bg.backdrop(ctx, cam.width, cam.height);
    bg.floor(ctx, cam, snap.arenaRadius);

    const ents = snap.entities.map((e) => ({ e, p: cam.project(centerOf(e)) })).filter((x) => x.p);
    ents.sort((a, b) => b.p.depth - a.p.depth);

    for (const { e } of ents) this.drawShadow(e);
    for (const { e, p } of ents) this.drawFigure(e, p, bg);
    this.drawEffects(snap.effects || []);
    const many = snap.entities.length > 12;
    if (this.showLabels) for (const { e } of ents) if (!many || e.plan === 'human') this.drawLabel(e, bg, snap.entities.length);
  }

  drawShadow(e) {
    const { ctx, camera: cam } = this;
    const c = centerOf(e);
    const r = (e.state === 'out' || e.state === 'down' ? 0.32 : 0.18) * (e.scale ?? 1.75) * (e.plan === 'quadruped' ? 1.6 : 1);
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const p = cam.project({ x: c.x + Math.cos(a) * r, y: 0.002, z: c.z + Math.sin(a) * r * 0.8 });
      if (!p) return;
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();
  }

  drawFigure(e, pp, bg) {
    const { ctx, camera: cam } = this;
    const plan = getBodyPlan(e.plan);
    const P = {};
    for (const name of plan.joints) P[name] = cam.project(e.joints[name]);
    const scale = e.scale ?? 1.75;
    const width = Math.max(1.5, (plan.boneWidth ?? 0.026) * scale * pp.s);
    const color = e.dead ? '#6b6b6b' : e.color;
    ctx.save();
    ctx.globalAlpha = e.state === 'out' ? 0.55 : 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // far bones first, darker; near bones in the team color
    const bones = plan.bones
      .map(([a, b, w]) => ({ a: P[a], b: P[b], w }))
      .filter((x) => x.a && x.b)
      .map((x) => ({ ...x, d: (x.a.depth + x.b.depth) / 2 }))
      .sort((x, y) => y.d - x.d);
    for (const bn of bones) {
      const far = bn.d > pp.depth + 0.02;
      ctx.strokeStyle = far ? shade(color, -0.35) : color;
      ctx.lineWidth = bn.w ? Math.max(1.5, bn.w * scale * ((bn.a.s + bn.b.s) / 2)) : width;
      ctx.beginPath();
      ctx.moveTo(bn.a.x, bn.a.y);
      ctx.lineTo(bn.b.x, bn.b.y);
      ctx.stroke();
    }
    // joints
    ctx.fillStyle = bg.figure;
    for (const name of plan.joints) {
      const p = P[name];
      if (!p || name === plan.headJoint) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.min(width * 0.42, 6), 0, Math.PI * 2);
      ctx.fill();
    }
    // head
    const h = P[plan.headJoint];
    if (h) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, e.headRadius * h.s, 0, Math.PI * 2);
      ctx.fillStyle = shade(color, 0.55);
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, width * 0.6);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLabel(e, bg, count) {
    const { ctx, camera: cam } = this;
    const top = cam.project({ ...e.joints.head, y: e.joints.head.y + e.headRadius + 0.12 });
    if (!top) return;
    ctx.save();
    ctx.font = `600 ${count > 6 ? 10 : 12}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = bg.label;
    ctx.globalAlpha = e.state === 'out' ? 0.5 : 0.9;
    const label = e.state === 'out' ? `${e.name} — ${e.outReason || 'out'}` : e.state === 'down' ? `${e.name} — DOWN` : e.name;
    ctx.fillText(label, top.x, top.y - 10);
    if (e.state !== 'out') {
      const w = 40;
      const bars = [[e.vitals.consciousness, '#e5484d'], [e.vitals.stamina, '#f5a524']];
      bars.forEach(([v, c], i) => {
        const y = top.y - 6 + i * 4;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(top.x - w / 2, y, w, 3);
        ctx.fillStyle = c;
        ctx.fillRect(top.x - w / 2, y, w * Math.max(0, v), 3);
      });
    }
    ctx.restore();
  }

  drawEffects(effects) {
    const { ctx, camera: cam } = this;
    for (const fx of effects) {
      const p = cam.project(fx.pos);
      if (!p) continue;
      const life = 1 - fx.age / fx.duration;
      const r = (0.08 + 0.12 * fx.strength) * p.s * (1.3 - life * 0.5);
      ctx.save();
      ctx.globalAlpha = Math.max(0, life);
      ctx.strokeStyle = fx.kind === 'hit' ? '#ffd166' : '#9ecbff';
      ctx.fillStyle = fx.kind === 'hit' ? 'rgba(255,120,60,0.6)' : 'rgba(150,200,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const spikes = 8;
      for (let i = 0; i <= spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2;
        const rr = i % 2 ? r * 0.45 : r;
        const x = p.x + Math.cos(a) * rr;
        const y = p.y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = amt < 0 ? 0 : 255;
  const k = Math.abs(amt);
  r = Math.round(r + (t - r) * k);
  g = Math.round(g + (t - g) * k);
  b = Math.round(b + (t - b) * k);
  return `rgb(${r},${g},${b})`;
}
