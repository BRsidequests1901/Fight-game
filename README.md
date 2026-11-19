# Fight Sim

A fighting simulator grounded in real-world physics and human biology. Choose
fighters and fighting styles, optionally tune their attributes, and watch the
simulation play out. Version 0.1 draws stick figures, but the engine underneath
is built to grow: bigger groups, other species, richer visuals and recorded fights
you can send to an AI renderer.

## Play it

- **Online:** https://brsidequests1901.github.io/Fight-game/. GitHub Pages republishes the
  branch automatically on every push; `.github/workflows/tests.yml` runs the tests.
- **iPhone / iPad:** open that link in Safari, tap **Share → Add to Home Screen**. It then opens
  full-screen like an app and also works offline after the first visit.
  Drag to orbit, pinch to zoom, double-tap to reset the camera.
- **Android:** open the link in Chrome and choose **Install app** / **Add to Home screen**.

Hosting setup (already done): repo **Settings → Pages → Deploy from a branch**, branch
`claude/fighter-simulator-game-ny7url`, folder `/ (root)`.

## Run it locally

```bash
npm start          # zero-dependency static server → http://localhost:8080
                   # (phone on the same Wi-Fi: http://<your-computer-ip>:8080)
npm test           # headless simulation tests (Node 18+)
npm run batch -- tigerVsFive 500   # run 500 fights headless, print win rates
```

No build step and no dependencies: plain ES modules.

## What you can do (v0.2)

- **Fighters & styles:** Boxing, Muay Thai, Tiger style (Hu Quan), traditional Kung Fu,
  Karate, Taekwondo, Wing Chun, an untrained brawler, and the grappling arts Wrestling,
  Brazilian Jiu-Jitsu, Judo and MMA. Picking a style alone is enough, because each style
  has realistic default attributes and body size.
- **Animals:** goose, dog (German Shepherd), Bengal tiger, grizzly bear, each with its own
  skeleton, size, natural weapons (beak, wing knob, bites that latch on, claws, pounces,
  charges) and behavior. Mix them freely with humans, for example 1 human vs 99 geese.
- **Rules:** *Sport* (referee, gloves, mat, 10-count, no hitting a downed fighter),
  *Street fight* (bare knuckles, concrete, downed people get kicked, people give up or
  animals flee), *To the pain* (continues past unconsciousness until someone is maimed)
  and *To the death* (ends only in death).
- **Realism slider:** 100% is strictly realistic. Toward *Movie*, exchanges last longer,
  knockback grows, gore drops, the outnumbered hero holds up, and groups attack a few
  at a time while the rest circle.
- **Grappling toggle:** clinch, double-leg takedowns, throws, guard / mount / back,
  ground-and-pound, sweeps, escapes, chokes and joint locks (tap, or the limb breaks if
  nobody taps under the rules).
- **Attributes** use a tabletop-style 1–20 scale (10 = average untrained adult,
  14–16 = trained athlete, 18–20 = elite): Strength, Dexterity, Endurance, Durability,
  Technique, plus height, weight and stance.
- **Teams and groups:** up to 4 teams, each with any mix of fighters. "Count" clones a fighter
  (for example, 1 tiger-style fighter vs 5 kung fu fighters).
- **Camera:** drag to orbit, scroll to zoom. Backgrounds can be swapped.
- **Replays:** the same seed reproduces the exact same fight. *Save recording* downloads a
  JSON file that *Load recording* plays back with a scrubber. *Record video* captures a WebM.
- **AI rendering hand-off:** *Pose view* switches to an OpenPose control image (record it
  as a control video), and *AI render kit* downloads a prompt, a shot list and per-frame
  OpenPose keypoints. See "AI rendering" below.

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
    combat.js          strike resolution, damage, knockdowns, elimination
    grapple.js         clinch, ground positions, submissions, bites that latch, pins
    injury.js          fractures, bleeding, brain injury, strangulation, death
    rules.js           rule sets (sport/street/pain/death) and the realism slider
    species.js         per-species biology (regions, tolerances, bones, blood)
    scenario.js        config schema, presets
    bodies/            body plans: anthropometrics + skeleton + procedural pose
      human.js  quadruped.js  bird.js
  render/              renderers consume *snapshots* only
    stickRenderer.js   line-and-dot 2.5D renderer (Canvas 2D)
    camera.js          perspective orbit camera with auto-framing
    backgrounds.js     pluggable scenes
  playback/
    snapshot.js        sim → snapshot; LiveSource (real-time driver)
    recorder.js        records config+seed and a baked skeleton track
    replay.js          plays a recording without the simulation
  export/              AI-render hand-off: OpenPose keypoints, prompt builder,
                       pluggable pipeline descriptions (no API calls)
  ui/                  setup form, HUD, fight log
```

Design rules that keep it extensible:

1. **The simulation never touches rendering.** It produces state, and a body plan turns
   that state into a 3D skeleton. Renderers draw snapshots, so a WebGL, sprite or
   motion-capture renderer can replace the stick figures without changing the simulation.
2. **The simulation is deterministic.** All randomness comes from one seeded RNG and the
   timestep is fixed, so a seed and a config fully describe a fight.
3. **Content is data.** Adding a style or technique means adding an object, not new code.
4. **Body plans and species are pluggable.** A body plan (`bodies/`) is a skeleton plus a pose
   generator; a species (`species.js`) is biology; a style (`styles.js`) is behavior and
   techniques. A new animal is usually a species entry, a style entry and a few techniques.
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
| Fractures | force vs. bone thresholds scaled by mass^(2/3), with gloves and striking-surface focus | nose ~1.6 kN, jaw ~3.8 kN, ribs ~4 kN, tibia ~5.5 kN; a body on the floor can't move away, so stomps are far worse |
| Blood | ~70 ml/kg, shock above ~20% loss, unconscious ~35%, fatal ~45%; cuts clot, deep bites don't | |
| Chokes | unconscious in ~9 s of a locked blood choke; held on, fatal | |
| Bites | bite force (dog ~1.1 kN, tiger ~4.5 kN, bear ~5 kN) → bleeding, crushing fractures, latching & shaking | |

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

## AI rendering

Kept tool-agnostic on purpose: `src/export/pipelines.js` lists the targets, and the
exported kit only contains open formats (OpenPose COCO-18 keypoints, text prompt, shot list).

Current recommendation (late 2026):

1. **Wan 2.x pose control (VACE / Animate / Fun-Control) in ComfyUI.** Open weights, self-hosted or on
   a rented GPU, and the motion follows our skeleton frame by frame. Feed it the *Pose view*
   video (or the kit's keypoints) plus the prompt and an optional reference image per character.
2. **Kling Motion Control.** The easiest hosted option: upload the motion video and a
   picture of each character.
3. **Any video-to-video restyler** (Runway, Luma…). The simplest route, with the least precise motion.

Human OpenPose control is mature. Animals currently need depth or edge control instead
(the pose view draws them as plain grey skeletons), which is a natural next export to add.

## Roadmap ideas

- Depth-map and per-character mask exports for AI rendering; BVH/FBX motion export
- Swarm tactics for large animal groups (encircle, harass from behind)
- Rounds, corner recovery, cuts that affect vision
- Physics-based ragdoll falls, and finer hit detection on limb capsules
- WebGL renderer with skinned meshes; environment props and obstacles
- Export to BVH/FBX motion files and an AI video rendering pipeline
- Balancing tools: batch-run matchups and show win-rate tables in the UI
