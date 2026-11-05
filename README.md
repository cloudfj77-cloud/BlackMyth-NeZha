# White Myth: Nezha · 白神话：哪吒

3D third-person boss fight on ForgeaX Engine 0.4.19 (WebGPU). This build is **M1 Foundation**:
Nezha hovers on his Wind-Fire Wheels through a greybox Dragon Palace with a right-shoulder
camera, lock-on, procedural float, and Chinese / English UI.

Design sources live outside this project in `../design/` (spec, milestone M1, prep plan).

## Controls (M1)

| Input | Action |
|:--|:--|
| Click the game | Lock the mouse (camera look) |
| W A S D | Hover move (camera-relative) |
| Shift (hold > 0.2 s) | Dash (sprint); a tap is reserved for the M2 step-dodge |
| Mouse | Turn camera |
| R | Lock on / release (within 25 m; breaks beyond 30 m) |
| Esc | Release mouse and pause |
| F2 (`?dev=1` only) | Development tuning panel (releases the mouse) |

## URL flags

| Flag | Meaning |
|:--|:--|
| `?qa=1` | Mirror the `nezha` read projection into the menu host (`data-nezha`) for acceptance on the static preview |
| `?dev=1` | Development build features: F2 tuning panel, presets, export of `tuning.json`; implies `qa` |
| `?dev=1&lang=pseudo` | Pseudo-locale (+30 % length, brackets) |
| `?dev=1&grey=1` | Grey-model silhouette review |
| `?dev=1&target=2x4` | Lock target height × length preset |

## Build, preview, accept

```bash
export PATH="$HOME/.local/bin:$PATH"
pnpm test && pnpm typecheck && pnpm exec forgeax project check --json
bash scripts/build.sh                                   # forgeax project build --html-head web/head.html
pnpm exec forgeax project preview --port 4191 --json    # serve dist/
node qa/m1-acceptance.cjs http://localhost:4191/        # real input through system Chrome, screenshots in artifacts/m1/
pnpm exec forgeax project play scripts/playthrough.mjs --require-ui --json   # official play (run in a normal terminal)
```

## Template Disposition (game-3d → nezha-boss)

| Template content | Disposition |
|:--|:--|
| `forge.json` roots (engine / frontend) | Kept: the only plugin entry |
| `assets/game.pack.ts`, `physics.pack.json` | Kept (engine root mounts physics + scene owner) |
| `assets/world/world.pack.ts` | Kept, children replaced by the Nezha plugins |
| `assets/scene.pack.ts`, `geometry.pack.ts`, `materials.pack.ts` | Replaced: Dragon Palace greybox (canyon, plaza, pillars, palace wall), cool palette, Nezha placeholder |
| `assets/environment.pack.ts` | Replaced: deep-water light field (no daylight sky) |
| `assets/character.pack.ts` + `player/player-rig.ts` (skinned scout, walk clip) | Replaced: rigid greybox Nezha (body, 2.4 m spear, wheels, contact glow); no skeleton in M1 |
| `assets/player/player.ts`, `player.pack.ts` | Replaced by `hover-player/` |
| `assets/camera/camera.pack.ts` | Replaced by the right-shoulder camera; `third-person.ts` math kept |
| `assets/guide.ui.*`, `ui/guide-controller.ts` | Replaced by `ui/menu.ui.*` + `ui/menu-controller.ts` |
| `assets/fantasy-meshes.pack.ts`, `uv-primitives.pack.ts`, `runtime-vase/`, `ui/vase-controls.ts`, `ui/player-controls.ts` | Deleted (showcase, vase, touch controls) with their tests and probes |
| `shaders/rusted-iron.wgsl` | Deleted; Surface examples now `light-beam.wgsl`, `contact-glow.wgsl` |
| `docs/feedback.md` | Kept; confirmed Engine/SDK issues appended |

## Source map

| Path | Owns |
|:--|:--|
| `assets/data/tuning.json` | Every tunable default (movement, camera, float, sash, lock, ambience, occlusion) |
| `assets/shared/tuning.ts` | Tuning types, panel ranges, clamped live copy |
| `assets/shared/layout.ts`, `greybox.ts` | Level layout authority (meshes, colliders, placement) |
| `assets/shared/protocol.ts` | Engine ↔ frontend messages (no player-visible text) |
| `assets/core/core.pack.ts` | Phase, live tuning, the single QA projection `nezha` |
| `assets/ui/*` | Start / pause menu, HUD hints, language choice, dev panel |
| `assets/i18n/*` | Language rules, pseudo-locale, translator context for every key |
| `assets/runtime/zaohua-platform-init.js` | Zaohua platform SDK base `initialize` (capabilities: none) |
| `qa/` | Built-preview acceptance with real input |
