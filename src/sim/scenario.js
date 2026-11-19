// Fight configuration: normalization, defaults and ready-made presets.
import { STYLES } from './styles.js';

export const DEFAULT_RULES = { timeLimit: 180, threeKnockdownRule: true };

/**
 * Config shape:
 * {
 *   seed: number,
 *   rules: { timeLimit: seconds (0 = none), threeKnockdownRule: bool },
 *   arena: { radius?: meters, background?: string },
 *   teams: [{ name, color, fighters: [{ name, style, count?, stance?, heightCm?, weightKg?, attrs?: {...} }] }]
 * }
 */
export function normalizeConfig(cfg) {
  const teams = (cfg.teams || []).map((t, ti) => ({
    name: t.name || `Team ${ti + 1}`,
    color: t.color || ['#e5484d', '#3e8ef7', '#46a758', '#f5a524'][ti % 4],
    fighters: (t.fighters || []).map((f, fi) => {
      if (!STYLES[f.style]) throw new Error(`Unknown style "${f.style}"`);
      return {
        name: f.name || `${STYLES[f.style].name} ${fi + 1}`,
        style: f.style,
        count: Math.max(1, Math.min(99, Math.floor(f.count || 1))),
        stance: f.stance === 'southpaw' ? 'southpaw' : 'orthodox',
        plan: f.plan || 'human',
        heightCm: f.heightCm,
        weightKg: f.weightKg,
        attrs: f.attrs ? { ...f.attrs } : undefined,
      };
    }),
  }));
  if (teams.length < 2) throw new Error('A fight needs at least two teams');
  return {
    seed: (cfg.seed ?? 1) >>> 0,
    rules: { ...DEFAULT_RULES, ...(cfg.rules || {}) },
    arena: { background: 'dojo', ...(cfg.arena || {}) },
    teams,
  };
}

/** Expand `count` into individual fighter configs with unique names. */
export function expandTeam(team) {
  const out = [];
  for (const f of team.fighters) {
    for (let i = 0; i < f.count; i++) {
      out.push({ ...f, name: f.count > 1 ? `${f.name} ${i + 1}` : f.name });
    }
  }
  return out;
}

export const PRESETS = {
  boxerVsMuayThai: {
    label: 'Boxer vs Muay Thai',
    config: {
      teams: [
        { name: 'Red', fighters: [{ name: 'Boxer', style: 'boxing' }] },
        { name: 'Blue', fighters: [{ name: 'Nak Muay', style: 'muayThai' }] },
      ],
    },
  },
  tigerVsFive: {
    label: 'Tiger style vs 5 Kung Fu',
    config: {
      rules: { timeLimit: 300, threeKnockdownRule: false },
      teams: [
        { name: 'Red', fighters: [{ name: 'Tiger', style: 'tiger', attrs: { strength: 18, dexterity: 16, endurance: 18, durability: 17, technique: 18 } }] },
        { name: 'Blue', fighters: [{ name: 'Kung Fu', style: 'kungFu', count: 5 }] },
      ],
    },
  },
  karateVsBrawler: {
    label: 'Karate vs Street brawler',
    config: {
      teams: [
        { name: 'Red', fighters: [{ name: 'Karateka', style: 'karate' }] },
        { name: 'Blue', fighters: [{ name: 'Brawler', style: 'brawler' }] },
      ],
    },
  },
  tkdVsWingChun: {
    label: 'Taekwondo vs Wing Chun',
    config: {
      teams: [
        { name: 'Red', fighters: [{ name: 'TKD', style: 'taekwondo' }] },
        { name: 'Blue', fighters: [{ name: 'Wing Chun', style: 'wingChun' }] },
      ],
    },
  },
  threeVsThree: {
    label: '3 vs 3 mixed',
    config: {
      rules: { timeLimit: 240, threeKnockdownRule: false },
      teams: [
        { name: 'Red', fighters: [{ name: 'Boxer', style: 'boxing' }, { name: 'Nak Muay', style: 'muayThai' }, { name: 'Tiger', style: 'tiger' }] },
        { name: 'Blue', fighters: [{ name: 'Karateka', style: 'karate' }, { name: 'TKD', style: 'taekwondo' }, { name: 'Brawler', style: 'brawler' }] },
      ],
    },
  },
};
