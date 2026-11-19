// A combatant: identity, species & body, physiology, kinematic state and vital signs.
import { STYLES, SPECIES_BODY } from './styles.js';
import { TECHNIQUES, techniqueReach } from './techniques.js';
import { derivePhysiology, ATTRIBUTES } from './physiology.js';
import { getBodyPlan } from './bodies/index.js';
import { getSpecies } from './species.js';
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
    this.species = { id: style.species || 'human', ...getSpecies(style.species) };
    this.plan = getBodyPlan(this.species.plan);
    this.attrs = {};
    for (const { key } of ATTRIBUTES) this.attrs[key] = cfg.attrs?.[key] ?? style.attrs[key] ?? 10;
    this.body = this.plan.build(cfg.heightCm ?? style.height, cfg.weightKg ?? style.weight, SPECIES_BODY[this.species.id]);
    this.phys = derivePhysiology(this.attrs, this.body);
    const tol = this.species.tol;
    this.phys.headTol *= tol.head;
    this.phys.bodyTol *= tol.body;
    this.phys.legTol *= tol.legs;
    Object.assign(this.phys, this.species.physMods);
    this.leadSign = cfg.stance === 'southpaw' ? 1 : -1;

    // kinematics (ground plane x/z, meters)
    this.pos = { x: 0, z: 0 };
    this.vel = { x: 0, z: 0 };
    this.facing = 0;
    this.gaitPhase = rng.next() * Math.PI * 2;

    // behavior
    this.state = 'ready'; // ready | attack | defend | stagger | grapple | down | out
    this.action = null;
    this.targetId = null;
    this.intent = { x: 0, z: 0 };
    this.thinkTimer = rng.next() * 0.3;
    this.circleDir = rng.next() < 0.5 ? -1 : 1;
    this.comboQueue = [];
    this.altHand = false;
    this.link = null; // grapple / bite link
    this.role = null; // clinch | top | bottom | biter | bitten
    this.linkView = null;

    // vitals
    this.stamina = this.phys.staminaCap;
    this.concussion = 0;
    this.daze = 0;
    this.brainInjury = 0;
    this.bodyTrauma = 0;
    this.legTrauma = 0;
    this.balance = 1;
    this.flinch = 0;
    this.bloodVolume = this.species.bloodPerKg * this.body.mass;
    this.bloodLost = 0;
    this.bleedRate = 0; // liters per minute
    this.hypoxia = 0;
    this.anoxia = 0;
    this.choked = false;
    this.injuries = [];
    this.brokenLegs = 0;
    this.brokenArms = [];
    this.brokenWings = 0;
    this.vision = 1;
    this.aerobicMult = 1;
    this.dead = false;
    this.deathCause = null;
    this.yielded = false;
    this.tapped = null;
    this.chokedOut = false;
    this.refStopped = false;
    this.countedOut = false;
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
  bloodLossFrac() { return this.bloodLost / this.bloodVolume; }
  shock() { return clamp((this.bloodLossFrac() - 0.2) / 0.15, 0, 1); }
  consciousness() {
    if (this.dead) return 0;
    return clamp(1 - this.concussion - this.daze - this.shock() - this.hypoxia - this.brainInjury * 0.5, 0, 1);
  }
  condition() {
    return Math.min(this.consciousness(), 1 - this.bodyTrauma, 1 - this.legTrauma, 1 - this.bloodLossFrac() * 2);
  }
  /** Performance multiplier from fatigue and blood loss (speed, force). */
  fatigue() { return (0.65 + 0.35 * Math.sqrt(this.staminaFrac())) * (1 - 0.4 * this.shock()); }
  reactionTime() { return this.phys.reaction + 0.08 * (1 - this.staminaFrac()) + 0.15 * this.daze; }
  canStand() {
    return !this.dead && this.legTrauma < 1 && this.bodyTrauma < 1 && this.brokenLegs < this.species.legsToStand;
  }
  maxMoveSpeed() {
    const legs = this.brokenLegs > 0 ? 0.45 : 1;
    const bitten = this.role === 'bitten' ? 0.4 : 1;
    return this.phys.moveSpeed * this.fatigue() * (1 - 0.6 * this.legTrauma) * (1 - 0.4 * this.daze) * legs * bitten;
  }
  stability() {
    const st = this.style.stance;
    const quad = this.body.plan === 'quadruped' ? 1.6 : 1;
    return (0.7 + 0.3 * this.phys.force) * (1 - 0.6 * this.legTrauma) * (1 - 0.5 * this.daze)
      * (0.85 + (st.width ?? 0.15) + (st.crouch ?? 0)) * quad;
  }
  isActive() { return this.state !== 'out'; }
  isStanding() { return this.state !== 'out' && this.state !== 'down' && this.role !== 'bottom'; }
  isLying() { return this.fallT > 0.5 || this.role === 'bottom'; }

  /** Can this limb currently be used to strike? */
  limbUsable(tech) {
    if (this.brokenArms.includes(tech.limb)) return false;
    if (tech.limb === 'wing' && this.brokenWings > 0) return false;
    if ((tech.limb === 'leadLeg' || tech.limb === 'rearLeg') && this.brokenLegs > 0) return false;
    return true;
  }

  /** Natural fighting distance (center to center) for this fighter's style. */
  preferredDistance() {
    if (this._prefDist == null) {
      let sum = 0;
      let wsum = 0;
      for (const [id, w] of Object.entries(this.style.techniques)) {
        const t = TECHNIQUES[id];
        if (t.requires || t.kind === 'grapple') continue;
        sum += w * (techniqueReach(this, t) + 0.1 + t.step * 0.5);
        wsum += w;
      }
      this._prefDist = wsum ? (sum / wsum) * 0.95 * (this.style.rangePref ?? 1) : 1;
    }
    return this._prefDist;
  }

  endAction() {
    this.action = null;
    this.state = this.link && this.role !== 'bitten' ? 'grapple' : 'ready';
  }

  updatePhysiology(dt) {
    if (this.state === 'out' && !this.yielded) {
      this.flinch *= Math.exp(-5 * dt);
      return;
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const massRatio = this.body.mass / 75;
    const lying = this.state === 'down' || this.role === 'bottom';
    const use = (lying ? 150 : 230 + 110 * speed * speed) * massRatio + (this.link ? 250 * massRatio : 0);
    const supply = this.phys.aerobic * this.aerobicMult * (1 - 0.6 * this.shock());
    this.stamina = clamp(this.stamina + (supply - use) * dt, 0, this.phys.staminaCap);
    this.daze = Math.max(0, this.daze - dt * 0.035);
    if (this.isStanding()) this.balance = Math.min(1, this.balance + dt * 0.9 * (1 - 0.5 * this.legTrauma));
    this.flinch *= Math.exp(-5 * dt);
  }

  spendStamina(joules) {
    this.stamina = Math.max(0, this.stamina - joules);
  }
}
