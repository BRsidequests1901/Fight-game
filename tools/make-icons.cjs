// Regenerates the app icons (needs Playwright): node tools/make-icons.cjs
const { chromium } = require('playwright');
const path = require('path');

const draw = (size, maskable) => `
<canvas id=c width=${size} height=${size}></canvas>
<script>
const c = document.getElementById('c'), x = c.getContext('2d'), s = ${size};
x.fillStyle = '#16181d';
if (${maskable}) x.fillRect(0, 0, s, s);
else { const r = s * 0.22; x.beginPath(); x.roundRect(0, 0, s, s, r); x.fill(); }
const k = ${maskable} ? 0.72 : 0.86, o = (1 - k) / 2 * s;
const P = (px, py) => [o + px * k * s, o + py * k * s];
function fig(color, pts, head) {
  x.strokeStyle = color; x.lineWidth = s * 0.045; x.lineCap = 'round'; x.lineJoin = 'round';
  for (const seg of pts) { x.beginPath(); seg.forEach((p, i) => { const [a, b] = P(...p); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.stroke(); }
  const [hx, hy] = P(...head); x.beginPath(); x.arc(hx, hy, s * 0.055 * k / 0.86, 0, Math.PI * 2); x.fillStyle = color; x.fill();
}
// red: roundhouse kick
fig('#e5484d', [[[0.3, 0.33], [0.3, 0.58]], [[0.3, 0.58], [0.24, 0.75], [0.27, 0.92]], [[0.3, 0.58], [0.48, 0.5], [0.62, 0.44]],
  [[0.3, 0.38], [0.38, 0.33], [0.36, 0.26]], [[0.3, 0.38], [0.22, 0.44], [0.2, 0.36]]], [0.29, 0.22]);
// blue: guard, leaning back
fig('#3e8ef7', [[[0.72, 0.36], [0.74, 0.6]], [[0.74, 0.6], [0.66, 0.76], [0.64, 0.92]], [[0.74, 0.6], [0.8, 0.77], [0.84, 0.92]],
  [[0.72, 0.41], [0.64, 0.42], [0.65, 0.33]], [[0.72, 0.41], [0.79, 0.46], [0.72, 0.34]]], [0.71, 0.25]);
// impact spark
const [ix, iy] = P(0.64, 0.43); x.fillStyle = '#ffd166'; x.beginPath();
for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2, r = (i % 2 ? 0.025 : 0.06) * s; i ? x.lineTo(ix + Math.cos(a) * r, iy + Math.sin(a) * r) : x.moveTo(ix + r, iy); }
x.fill();
</script>`;

(async () => {
  const b = await chromium.launch();
  const out = path.join(__dirname, '..', 'icons');
  for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<style>body{margin:0;background:transparent}</style>${draw(size, maskable)}`);
    await (await p.$('#c')).screenshot({ path: path.join(out, name), omitBackground: !maskable });
  }
  await b.close();
})();
