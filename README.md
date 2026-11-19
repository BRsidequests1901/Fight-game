# Fight Sim

A fighting simulator grounded in real-world physics and human biology. Choose
fighters and fighting styles, optionally tune their attributes, and watch the
simulation play out. Version 0.1 draws stick figures, but the engine underneath
is built to grow: bigger groups, other species, richer visuals and recorded fights
you can send to an AI renderer.

## Run it

```bash
npm start          # zero-dependency static server → http://localhost:8080
npm test           # headless simulation tests (Node 18+)
npm run batch -- tigerVsFive 500   # run 500 fights headless, print win rates
```

No build step and no dependencies: plain ES modules.

## What you can do (v0.1)

- **Fighters & styles:** Boxing, Muay Thai, Tiger style (Hu Quan), traditional Kung Fu,
  Karate, Taekwondo, Wing Chun, and an untrained brawler. Picking a style alone is
  enough, because each style has realistic default attributes and body size.
- **Attributes** use a tabletop-style 1–20 scale (10 = average untrained adult,
  14–16 = trained athlete, 18–20 = elite): Strength, Dexterity, Endurance, Durability,
  Technique, plus height, weight and stance.
- **Teams and groups:** up to 4 teams, each with any mix of fighters. "Count" clones a fighter
  (for example, 1 tiger-style fighter vs 5 kung fu fighters).
- **Camera:** drag to orbit, scroll to zoom. Backgrounds can be swapped.
- **Replays:** the same seed reproduces the exact same fight. *Save recording* downloads a
  JSON file that *Load recording* plays back with a scrubber. *Record video* captures a WebM.

## Architecture

```
src/
  sim/                 deterministic simulation (no DOM; runs in browser and Node)
    simulation.js      world: fixed 120 Hz timestep, seeded RNG, collisions, win conditions
    fighter.js         a combatant: body, physiology, kinematics, vital signs
    physiology.js      attributes → physical quantities; strike impact physics
    techniques.js      strike definitions (speed, effective mass, reach, timing…)
    styles.js          fighting styles as data (stance, guard, technique mix, tactics)
    ai.js              targeting, reaction-time-limited defense, attacks, footwork
    combat.js          strike resolution, damage, knockdowns, KO/TKO
    scenario.js        config schema, presets
    bodies/            body plans: anthropometrics + skeleton + procedural pose
      human.js
  render/              renderers consume *snapshots* only
    stickRenderer.js   line-and-dot 2.5D renderer (Canvas 2D)
    camera.js          perspective orbit camera with auto-framing
    backgrounds.js     pluggable scenes
  playback/
    snapshot.js        sim → snapshot; LiveSource (real-time driver)
    recorder.js        records config+seed and a baked skeleton track
    replay.js          plays a recording without the simulation
  ui/                  setup form, HUD, fight log
```

Design rules that keep it extensible:

1. **The simulation never touches rendering.** It produces state, and a body plan turns
   that state into a 3D skeleton. Renderers draw snapshots, so a WebGL, sprite or
   motion-capture renderer can replace the stick figures without changing the simulation.
2. **The simulation is deterministic.** All randomness comes from one seeded RNG and the
   timestep is fixed, so a seed and a config fully describe a fight.
3. **Content is data.** Adding a style or technique means adding an object, not new code.
4. **Body plans are pluggable.** `bodies/index.js` is a registry. A goose, dog or bear gets
   its own anthropometrics, skeleton and pose generator, and a new species will also need
   its own technique set.
5. **Groups need no special handling.** Teams can be any size, AI picks targets and spaces
   out from allies, and the arena scales with headcount.

## Realism notes

Approximate figures, chosen to land in published measured ranges:

| Quantity | Model | Real-world reference |
|---|---|---|
| Segment masses and lengths | Winter's anthropometric tables (head+neck 8.1%, trunk 49.7%…) | Winter, *Biomechanics and Motor Control of Human Movement* |
| Strike force | effective mass × contact speed, inelastic collision, half-sine pulse | Trained cross ≈ 3–5 kN (Walilko 2005; Smith 2000) |
| Head acceleration | peak force ÷ head mass; hooks and kicks weighted for rotation | Punches 30–100 g; KOs correlate with high (especially rotational) acceleration |
| Reaction time | 0.15–0.4 s depending on Dexterity, Technique, fatigue and daze | Fast jabs land before a defender can react. Kicks and haymakers can be read. |
| Stamina | anaerobic reserve (J) drained by strike kinetic energy and movement, refilled by aerobic power | Kicks are far costlier than jabs. Fatigue slows strikes and drops the guard. |
| Damage | concussion (cumulative) plus daze (transient), body trauma (liver shots), leg trauma (mobility) | KO, TKO from body or legs, knockdowns with a 10-count |
| Balance | momentum transfer vs. stance stability; push kicks knock fighters back | |

The fight log shows force (kN) and head acceleration (g) for every landed strike.

## Recording format

`fight-<seed>.json` contains:

- `config` + `config.seed`, which re-simulate the fight exactly on the same engine version;
- `skeletons`: joint names and bone pairs for each body plan, so it is self-describing;
- `frames` at 30 fps: per-entity joint positions (meters, y-up), state and vitals;
- `events`: every strike with technique, region, result, force, head g, plus knockdowns and the outcome.

The baked joint track is the hand-off point for future pipelines: retargeting onto
3D character rigs, or conditioning an AI video model (pose-to-video) with a background
and realistic characters.

## Roadmap ideas

- Clinch, takedowns and ground fighting (grappling styles: wrestling, BJJ, judo)
- Non-human body plans (goose, dog, big cats) and swarm behavior for large groups
- Rounds, a referee, corner recovery, cuts that affect vision
- Physics-based ragdoll falls, and finer hit detection on limb capsules
- WebGL renderer with skinned meshes; environment props and obstacles
- Export to BVH/FBX motion files and an AI video rendering pipeline
- Balancing tools: batch-run matchups and show win-rate tables in the UI
