// Headless batch runner for balancing and "what if" questions:
//   node tools/batch.js boxerVsMuayThai 200
//   node tools/batch.js my-config.json 500
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/simulation.js';
import { PRESETS } from '../src/sim/scenario.js';

const [what = 'boxerVsMuayThai', nArg = '100'] = process.argv.slice(2);
const n = Number(nArg);
const config = PRESETS[what] ? PRESETS[what].config : JSON.parse(readFileSync(what, 'utf8'));
const tally = {};
const methods = {};
let totalTime = 0;
for (let seed = 1; seed <= n; seed++) {
  const sim = new Simulation({ ...config, seed });
  const r = sim.runToEnd();
  const w = r.winner == null ? 'draw' : sim.config.teams[r.winner].name;
  tally[w] = (tally[w] || 0) + 1;
  const m = r.method.replace(/ \(.*\)/, '');
  methods[m] = (methods[m] || 0) + 1;
  totalTime += r.time;
}
console.log(`${n} fights of "${PRESETS[what]?.label ?? what}"`);
for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(12)} ${((v / n) * 100).toFixed(1)}%`);
console.log('  methods:', methods);
console.log(`  average length: ${(totalTime / n).toFixed(1)} s`);
