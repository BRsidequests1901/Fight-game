// Turns a fight (recording or live snapshot data) into text for generative models:
// an overall prompt, a negative prompt and a timestamped shot list.
import { STYLES } from '../sim/styles.js';
import { TECHNIQUES } from '../sim/techniques.js';
import { RULESETS } from '../sim/rules.js';

const SCENES = {
  dojo: 'a traditional wooden dojo with paper screens and warm afternoon light',
  ring: 'a professional fight arena with a blue canvas mat, ring lights and a dark crowd',
  void: 'an abstract dark training space with a glowing floor grid',
};

const article = (s) => (/^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`);

function describeEntity(e) {
  const style = STYLES[e.styleId];
  if (style?.category === 'animal') return article(style.name.toLowerCase());
  const build = e.massKg > 90 ? 'heavyset' : e.massKg < 65 ? 'lean' : 'athletic';
  return article(`${build} ${style ? style.name : e.style} fighter`);
}

export function buildPrompt(rec, { scene, look = 'cinematic, photorealistic, natural motion blur, 35mm film' } = {}) {
  const teams = rec.teams.map((t, ti) => {
    const members = rec.entities.filter((e) => e.team === ti);
    const groups = {};
    for (const e of members) {
      const d = describeEntity(e);
      groups[d] = (groups[d] || 0) + 1;
    }
    return Object.entries(groups).map(([d, n]) => (n > 1 ? `${n} ${d.replace(/^an? /, '').replace(/\s*\(.*\)/, '')}s` : d)).join(' and ');
  });
  const mode = RULESETS[rec.config.rules.mode];
  const setting = scene || SCENES[rec.config.arena?.background] || SCENES.dojo;
  const prompt = `${teams.join(' versus ')}, a ${mode.name.toLowerCase()} fight in ${setting}. ${look}. Motion follows the pose control exactly.`;
  const negative = 'extra limbs, deformed hands, morphing bodies, duplicate people, text, watermark, cartoon, low quality, flicker';
  const names = rec.entities.map((e) => e.name);
  const shots = [];
  for (const ev of rec.events) {
    if (ev.type === 'strike' && ev.result === 'hit' && (ev.note || (ev.force || 0) > 4000)) {
      shots.push({ t: ev.t, text: `${names[ev.attacker]} lands a ${TECHNIQUES[ev.tech]?.name.toLowerCase() ?? ev.tech} to the ${ev.region} of ${names[ev.target]}${ev.note ? ` (${ev.note})` : ''}` });
    } else if (ev.type === 'knockdown') {
      shots.push({ t: ev.t, text: `${names[ev.fighter]} goes down` });
    } else if (ev.type === 'out') {
      shots.push({ t: ev.t, text: `${names[ev.fighter]} is out: ${ev.reason}` });
    } else if (ev.type === 'note' && ev.big) {
      shots.push({ t: ev.t, text: ev.text.replace('{a}', names[ev.a] ?? '').replace('{b}', names[ev.b] ?? '') });
    }
  }
  return { prompt, negativePrompt: negative, shots };
}
