// Vital-sign panel and fight log.
import { TECHNIQUES } from '../sim/techniques.js';

const BARS = [
  ['consciousness', 'Head', '#e5484d'],
  ['body', 'Body', '#8e4ec6'],
  ['legs', 'Legs', '#3e8ef7'],
  ['stamina', 'Stamina', '#f5a524'],
  ['blood', 'Blood', '#a3171b'],
];
const CROWD = 12;

export class Hud {
  constructor(hudEl, logEl) {
    this.hudEl = hudEl;
    this.logEl = logEl;
    this.rows = [];
    this.logged = 0;
  }

  reset(snap) {
    this.hudEl.replaceChildren();
    this.crowd = snap.entities.length > CROWD;
    this.teamRows = [];
    if (this.crowd) {
      // big groups: one summary line per large team, full rows for small teams
      snap.teams.forEach((t, ti) => {
        const n = snap.entities.filter((e) => e.team === ti).length;
        if (n <= 3) return;
        const row = document.createElement('div');
        row.className = 'hud-team';
        this.hudEl.append(row);
        this.teamRows.push({ ti, row, name: t.name, color: t.color });
      });
    }
    const big = new Set(this.teamRows.map((r) => r.ti));
    this.rows = snap.entities.map((e) => {
      if (big.has(e.team)) return null;
      const row = document.createElement('div');
      row.className = 'hud-f';
      row.innerHTML = `<div class="hud-name"><span><span class="chip" style="background:${e.color}"></span>${escape(e.name)} <span class="st" style="font-weight:400">· ${escape(e.style)}</span></span><span class="st"></span></div>
        <div class="bars">${BARS.map(([, label, c]) => `<div class="bar">${label}<i><b style="background:${c};width:100%"></b></i></div>`).join('')}</div>
        <div class="hud-inj"></div>`;
      this.hudEl.append(row);
      return { row, state: row.querySelector('.hud-name > .st'), bars: [...row.querySelectorAll('.bar b')], inj: row.querySelector('.hud-inj'), injN: -1 };
    });
    this.logEl.replaceChildren();
    this.logged = 0;
  }

  update(snap) {
    for (const tr of this.teamRows) {
      const members = snap.entities.filter((e) => e.team === tr.ti);
      const active = members.filter((e) => e.state !== 'out').length;
      const dead = members.filter((e) => e.dead).length;
      tr.row.innerHTML = `<span class="chip" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${tr.color};margin-right:6px"></span><b>${escape(tr.name)}</b>: ${active} of ${members.length} still fighting${dead ? ` · ${dead} dead` : ''}`;
    }
    snap.entities.forEach((e, i) => {
      const r = this.rows[i];
      if (!r) return;
      r.row.classList.toggle('out', e.state === 'out');
      r.state.textContent = e.dead ? 'DEAD' : e.state === 'out' ? (e.outReason || 'out') : (e.role || e.state);
      BARS.forEach(([k], bi) => { r.bars[bi].style.width = `${Math.max(0, (e.vitals[k] ?? 1) * 100).toFixed(0)}%`; });
      const inj = e.injuries || [];
      if (inj.length !== r.injN) { r.injN = inj.length; r.inj.textContent = inj.join(' · '); }
    });
  }

  /** Append (or rebuild, after seeking backwards) log entries up to time t. */
  log(events, t, names) {
    let count = 0;
    while (count < events.length && events[count].t <= t) count++;
    if (count < this.logged) { this.logEl.replaceChildren(); this.logged = 0; }
    const frag = document.createDocumentFragment();
    for (let i = this.logged; i < count; i++) {
      const li = formatEvent(events[i], names);
      if (li) frag.prepend(li);
    }
    this.logEl.prepend(frag);
    this.logged = count;
    while (this.logEl.childElementCount > 400) this.logEl.lastElementChild.remove();
  }
}

function formatEvent(e, names) {
  const li = document.createElement('li');
  const t = `<span class="t">${fmtTime(e.t)}</span>`;
  const n = (id) => escape(names[id] ?? '?');
  if (e.type === 'strike') {
    const tech = TECHNIQUES[e.tech]?.name.toLowerCase() || e.tech;
    if (e.result === 'hit' || e.result === 'blocked' || e.result === 'checked') {
      const kn = (e.force / 1000).toFixed(1);
      const g = e.headG ? ` · ${e.headG.toFixed(0)} g` : '';
      const what = e.result === 'hit' ? `lands ${tech} to the ${e.region}` : `${tech} ${e.result}`;
      if (!e.force && e.note) { li.innerHTML = `${t}${n(e.attacker)} ${tech}: ${escape(e.note)} (${n(e.target)})`; return li; }
      const note = e.note ? ` — <b>${escape(e.note)}</b>` : '';
      li.innerHTML = `${t}${n(e.attacker)} ${what} (${n(e.target)}) · ${kn} kN${g}${e.counter ? ' · counter' : ''}${note}`;
      if (e.note === 'KNOCKOUT' || e.note === 'knockdown' || e.note === 'liver shot' || e.note === 'neck crushed') li.className = 'big';
    } else {
      li.className = 'miss';
      li.innerHTML = `${t}${n(e.attacker)} ${tech} — ${escape(e.note || e.result)}`;
    }
  } else if (e.type === 'knockdown') {
    li.className = 'big';
    li.innerHTML = `${t}${n(e.fighter)} is DOWN (knockdown #${e.count})`;
  } else if (e.type === 'getup') {
    li.innerHTML = `${t}${n(e.fighter)} beats the count`;
  } else if (e.type === 'out') {
    li.className = 'big';
    li.innerHTML = `${t}${n(e.fighter)} is out — ${escape(e.reason)}`;
  } else if (e.type === 'note') {
    li.className = e.big ? 'big' : '';
    li.innerHTML = `${t}${escape(e.text).replace('{a}', n(e.a)).replace('{b}', n(e.b))}`;
  } else if (e.type === 'end') {
    li.className = 'big';
    li.innerHTML = `${t}Fight over — ${escape(e.method)}`;
  } else {
    return null;
  }
  return li;
}

export function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
