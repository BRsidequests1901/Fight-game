// Setup screen: teams, fighters, styles/species, attributes.
import { STYLES, STYLE_IDS } from '../sim/styles.js';
import { ATTRIBUTES, ATTR_MIN, ATTR_MAX } from '../sim/physiology.js';
import { getSpecies } from '../sim/species.js';

const el = (tag, props = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n[k] = v;
  }
  for (const c of children.flat()) if (c != null) n.append(c);
  return n;
};

const GROUPS = [
  ['Striking arts', (s) => !s.category || s.category === 'striking'],
  ['Grappling arts', (s) => s.category === 'grappling'],
  ['Animals', (s) => s.category === 'animal'],
];

export function fighterFromStyle(styleId, name) {
  const s = STYLES[styleId];
  return {
    name: name || s.name.split(' (')[0],
    style: styleId,
    count: 1,
    stance: 'orthodox',
    heightCm: s.height,
    weightKg: s.weight,
    attrs: { ...s.attrs },
  };
}

/** Fill in any fields a preset left out, so the form always shows real values. */
export function hydrateTeams(teams) {
  return teams.map((t, i) => ({
    name: t.name || `Team ${i + 1}`,
    color: t.color || ['#e5484d', '#3e8ef7', '#46a758', '#f5a524'][i % 4],
    fighters: t.fighters.map((f) => {
      const base = fighterFromStyle(f.style, f.name);
      return { ...base, ...f, attrs: { ...base.attrs, ...(f.attrs || {}) } };
    }),
  }));
}

export function renderTeams(container, state, onChange) {
  const rerender = () => renderTeams(container, state, onChange);
  container.replaceChildren(...state.teams.map((team, ti) => {
    const card = el('div', { class: 'team' });
    card.style.setProperty('--team', team.color);
    card.append(el('div', { class: 'team-head' },
      el('input', { type: 'text', value: team.name, oninput: (e) => { team.name = e.target.value; onChange(); } }),
      el('input', { type: 'color', value: team.color, title: 'Team color', oninput: (e) => { team.color = e.target.value; card.style.setProperty('--team', team.color); onChange(); } }),
      state.teams.length > 2 ? el('button', { class: 'icon danger', title: 'Remove team', textContent: '✕', onclick: () => { state.teams.splice(ti, 1); rerender(); onChange(); } }) : null,
    ));
    team.fighters.forEach((f, fi) => card.append(fighterCard(team, f, fi, rerender, onChange)));
    card.append(el('button', {
      textContent: '+ Add fighter',
      onclick: () => { team.fighters.push(fighterFromStyle('boxing')); rerender(); onChange(); },
    }));
    return card;
  }), el('div', {},
    state.teams.length < 4 ? el('button', {
      textContent: '+ Add team',
      onclick: () => { state.teams.push(hydrateTeams([...state.teams, { fighters: [fighterFromStyle('brawler')] }])[state.teams.length]); rerender(); onChange(); },
    }) : null));
}

function styleSelect(f, onPick) {
  return el('select', { onchange: (e) => onPick(e.target.value) },
    GROUPS.map(([label, test]) => el('optgroup', { label },
      STYLE_IDS.filter((id) => test(STYLES[id])).map((id) => el('option', { value: id, textContent: STYLES[id].name, selected: id === f.style })))));
}

function fighterCard(team, f, fi, rerender, onChange) {
  const desc = el('p', { class: 'desc', textContent: STYLES[f.style].description });
  const attrsBox = el('div', { class: 'attrs' });
  const stanceBox = el('label', {}, 'Stance', el('select', { onchange: (e) => { f.stance = e.target.value; onChange(); } },
    ['orthodox', 'southpaw'].map((s) => el('option', { value: s, textContent: s, selected: s === f.stance }))));
  const drawAttrs = () => {
    const species = getSpecies(STYLES[f.style].species);
    const sr = species.sizeRange;
    stanceBox.style.visibility = species.humanoid ? 'visible' : 'hidden';
    attrsBox.replaceChildren(
      ...ATTRIBUTES.map(({ key, label, hint }) => slider(label, hint, f.attrs[key], ATTR_MIN, ATTR_MAX, 1, (v) => { f.attrs[key] = v; onChange(); })),
      slider(sr.heightLabel, 'Body size', f.heightCm, sr.height[0], sr.height[1], 1, (v) => { f.heightCm = v; onChange(); }),
      slider('Weight kg', 'Body mass', f.weightKg, sr.weight[0], sr.weight[1], sr.weight[1] < 10 ? 0.1 : 1, (v) => { f.weightKg = v; onChange(); }),
      el('div', {}, el('button', {
        textContent: 'Reset to style defaults',
        onclick: () => { Object.assign(f, fighterFromStyle(f.style, f.name), { count: f.count, stance: f.stance }); drawAttrs(); onChange(); },
      })),
    );
  };
  drawAttrs();
  return el('div', { class: 'fighter' },
    el('div', { class: 'fighter-grid' },
      el('label', {}, 'Name', el('input', { type: 'text', value: f.name, oninput: (e) => { f.name = e.target.value; onChange(); } })),
      el('label', {}, 'Style / creature', styleSelect(f, (id) => {
        const wasDefaultName = f.name === fighterFromStyle(f.style).name;
        const keep = { name: wasDefaultName ? fighterFromStyle(id).name : f.name, count: f.count, stance: f.stance };
        Object.assign(f, fighterFromStyle(id), keep);
        desc.textContent = STYLES[f.style].description;
        drawAttrs();
        onChange();
        rerender();
      })),
      el('label', { title: 'Number of identical fighters' }, 'Count', el('input', {
        type: 'number', min: 1, max: 150, value: f.count,
        oninput: (e) => { f.count = Math.max(1, Math.min(150, Number(e.target.value) || 1)); onChange(); },
      })),
      stanceBox,
      team.fighters.length > 1
        ? el('button', { class: 'icon danger', title: 'Remove fighter', textContent: '✕', onclick: () => { team.fighters.splice(fi, 1); rerender(); onChange(); } })
        : el('span'),
    ),
    desc,
    el('details', {}, el('summary', { textContent: 'Attributes & body (optional)' }), attrsBox),
  );
}

function slider(label, hint, value, min, max, step, onInput) {
  const out = el('output', { value: String(value) });
  return el('div', { class: 'attr', title: hint },
    el('span', { textContent: label }),
    el('input', {
      type: 'range', min, max, step, value,
      oninput: (e) => { const v = Number(e.target.value); out.value = String(v); onInput(v); },
    }),
    out);
}
