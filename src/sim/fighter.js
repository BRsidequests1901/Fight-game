// A combatant: identity, body, physiology, kinematic state and vital signs.
import { STYLES } from './styles.js';
import { TECHNIQUES, techniqueReach } from './techniques.js';
import { derivePhysiology, ATTRIBUTES } from './physiology.js';
import { getBodyPlan } from './bodies/index.js';
import { clamp } from './math.js';

export class Fighter {
  constructor(id, team, cfg, rng) {
    const style = STYLES[cfg.style];
    if (!style) throw new Error(`Unknown style: ${cfg.style}`);
    this.id = id;
    this.team = team;
    this.name = cfg.name;
    this.styleId = cfg.style;
    this.style = style;
    this.plan = getBodyPlan(cfg.plan || 'human');
    this.attrs = {};
    for (const { key } of ATTRIBUTES) this.attrs[key] = cfg.attrs?.[key] ?? style.attrs[key] ?? 10;
    this.body = this.plan.build(cfg.heightCm ?? style.height, cfg.weightKg ?? style.weight);
    this.phys = derivePhysiology(this.attrs, this.body);
    this.leadSign = cfg.stance === 'southpaw' ? 1 : -1;

    // kinematics (ground plane x/z, meters)
    this.pos = { x: 0, z: 0 };
    this.vel = { x: 0, z: 0 };
    this.facing = 0;
    this.gaitPhase = rng.next() * Math.PI * 2;

    // behavior
    this.state = 'ready'; // ready | attack | defend | stagger | down | out
    this.action = null;
    this.targetId = null;
    this.intent = { x: 0, z: 0 };
    this.thinkTimer = rng.next() * 0.3;
    this.circleDir = rng.next() < 0.5 ? -1 : 1;
    this.comboQueue = [];
    this.altHand = false;

    // vitals
    this.stamina = this.phys.staminaCap; // joules of anaerobic reserve
    this.concussion = 0; // cumulative brain trauma 0..1
    this.daze = 0; // transient, recovers
    this.bodyTrauma = 0; // 0..1 (1 = cannot continue)
    this.legTrauma = 0; // 0..1 (1 = cannot stand)
    this.bleed = 0; // cuts: reduce aerobic recovery
    this.balance = 1;
    this.flinch = 0;
    this.knockdowns = 0;
    this.downTimer = 0;
    this.getUpAt = 0;
    this.fallT = 0;
    this.rising = false;
    this.outReason = null;

    this.stats = { thrown: 0, landed: 0, blocked: 0, missed: 0, knockdowns: 0 };
    this._prefDist = null;
  }

  staminaFrac() { return clamp(this.stamina / this.phys.staminaCap, 0, 1); }
  consciousness() { return clamp(1 - this.concussion - this.daze, 0, 1); }
  condition() { return Math.min(this.consciousness(), 1 - this.bodyTrauma, 1 - this.legTrauma); }
  /** Performance multiplier from fatigue (speed, force). */
  fatigue() { return 0.65 + 0.35 * Math.sqrt(this.staminaFrac()); }
  reactionTime() { return this.phys.reaction + 0.08 * (1 - this.staminaFrac()) + 0.15 * this.daze; }
  maxMoveSpeed() { return this.phys.moveSpeed * this.fatigue() * (1 - 0.6 * this.legTrauma) * (1 - 0.4 * this.daze); }
  stability() {
    return (0.7 + 0.3 * this.phys.force) * (1 - 0.6 * this.legTrauma) * (1 - 0.5 * this.daze)
      * (0.85 + this.style.stance.width + this.style.stance.crouch);
  }
  isActive() { return this.state !== 'out'; }
  isStanding() { return this.state !== 'out' && this.state !== 'down'; }

  /** Natural fighting distance (center to center) for this fighter's style. */
  preferredDistance() {
    if (this._prefDist == null) {
      let sum = 0;
      let wsum = 0;
      for (const [id, w] of Object.entries(this.style.techniques)) {
        const t = TECHNIQUES[id];
        sum += w * (techniqueReach(this, t) + 0.1 + t.step * 0.5);
        wsum += w;
      }
      this._prefDist = (sum / wsum) * 0.95 * (this.style.rangePref ?? 1);
    }
    return this._prefDist;
  }

  endAction() {
    this.action = null;
    this.state = 'ready';
  }

  updatePhysiology(dt) {
    if (this.state === 'out') {
      this.flinch *= Math.exp(-5 * dt);
      return;
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const use = this.state === 'down' ? 150 : 230 + 110 * speed * speed; // metabolic watts
    const supply = this.phys.aerobic * (1 - 0.5 * clamp(this.bleed, 0, 1));
    this.stamina = clamp(this.stamina + (supply - use) * dt, 0, this.phys.staminaCap);
    this.daze = Math.max(0, this.daze - dt * 0.035);
    if (this.state !== 'down') this.balance = Math.min(1, this.balance + dt * 0.9 * (1 - 0.5 * this.legTrauma));
    this.flinch *= Math.exp(-5 * dt);
    this.bleed = Math.max(0, this.bleed - dt * 0.003);
  }

  spendStamina(joules) {
    this.stamina = Math.max(0, this.stamina - joules);
  }
}
