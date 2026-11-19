// Pluggable scene backdrops. Each one draws a backdrop (screen space) and a
// floor (world space through the camera). Swap or add entries freely.

function floorPolygon(ctx, cam, radius, y = 0, steps = 64) {
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const p = cam.project({ x: Math.cos(a) * radius, y, z: Math.sin(a) * radius });
    if (!p) continue;
    if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

function line(ctx, cam, a, b) {
  const pa = cam.project(a);
  const pb = cam.project(b);
  if (!pa || !pb) return;
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
}

function grid(ctx, cam, extent, step, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let x = -extent; x <= extent + 1e-6; x += step) {
    line(ctx, cam, { x, y: 0, z: -extent }, { x, y: 0, z: extent });
    line(ctx, cam, { x: -extent, y: 0, z: x }, { x: extent, y: 0, z: x });
  }
}

export const BACKGROUNDS = {
  dojo: {
    name: 'Dojo',
    figure: '#1d1a17',
    label: '#2a2420',
    backdrop(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#efe6d6');
      g.addColorStop(1, '#d8c7a8');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    floor(ctx, cam, R) {
      floorPolygon(ctx, cam, R + 6);
      ctx.fillStyle = '#c49a64';
      ctx.fill();
      grid(ctx, cam, Math.ceil(R + 6), 1, 'rgba(90,60,30,0.18)');
      floorPolygon(ctx, cam, R);
      ctx.fillStyle = 'rgba(236,225,196,0.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,40,30,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
    },
  },
  ring: {
    name: 'Arena',
    figure: '#f2f2f2',
    label: '#f2f2f2',
    backdrop(ctx, w, h) {
      const g = ctx.createRadialGradient(w / 2, h * 0.3, 10, w / 2, h * 0.4, Math.max(w, h));
      g.addColorStop(0, '#2b2f3a');
      g.addColorStop(1, '#0b0c10');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    floor(ctx, cam, R) {
      floorPolygon(ctx, cam, R + 1.2);
      ctx.fillStyle = '#121620';
      ctx.fill();
      floorPolygon(ctx, cam, R);
      ctx.fillStyle = '#23466e';
      ctx.fill();
      ctx.strokeStyle = '#d33';
      ctx.lineWidth = 3;
      ctx.stroke();
      floorPolygon(ctx, cam, R, 1.0);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    },
  },
  void: {
    name: 'Training grid',
    figure: '#e8f0ff',
    label: '#cfe0ff',
    backdrop(ctx, w, h) {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, w, h);
    },
    floor(ctx, cam, R) {
      grid(ctx, cam, Math.ceil(R + 4), 0.5, 'rgba(120,170,255,0.13)');
      floorPolygon(ctx, cam, R);
      ctx.strokeStyle = 'rgba(120,170,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    },
  },
};
