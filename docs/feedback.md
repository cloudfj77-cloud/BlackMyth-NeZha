# Game Feedback

Record confirmed Engine, SDK, template, build, asset, runtime, or browser issues
encountered while developing this game. This file and the root `README.md` are
shipped unchanged in the Web ZIP. Keep credentials and private URLs out of it.

```markdown
### YYYY-MM-DD — Short issue title

- Scope: Engine | SDK | template | build | asset | runtime | browser
- Reproduction: exact command or smallest user-visible sequence
- Expected: what should happen
- Actual: what happened
- Evidence: log, screenshot, URL, or commit path
- Status: open | workaround | fixed | blocked
```

### 2026-11-05 — Duplicate material-slot sourceKey passes build, fails only at runtime

- Scope: build / asset
- Reproduction: a Pack mesh with two `materialSlots` sharing the same `sourceKey` (e.g. two slots both using one material); `forgeax project build` succeeds.
- Expected: the cooker rejects the mesh at build time.
- Actual: startup fails in the browser with `plugin-startup-failed` → `asset-invalid-value: materialSlots[1].sourceKey is unique when present`.
- Evidence: fatal startup diagnostics on `project preview`; fixed by deriving `sourceKey` from slot name + material; `assets/__tests__/content.test.ts` now guards it.
- Status: workaround

### 2026-11-05 — `project play` cannot start its browser inside WorkBuddy

- Scope: browser
- Reproduction: `pnpm exec forgeax project play scripts/playthrough.mjs --require-ui --json` in the WorkBuddy agent shell.
- Expected: Chromium opens the game and runs the playthrough.
- Actual: `play-not-ready` / `browser.newPage: Target crashed`.
- Evidence: `artifacts/play/scripts/playthrough/play.json`.
- Status: workaround — `qa/m1-acceptance.cjs` drives the built `project preview` with system Chrome (puppeteer-core, `--enable-unsafe-webgpu`). Headless pointer lock needs `Emulation.setFocusEmulationEnabled` + `bringToFront`, otherwise `requestPointerLock` fails with `WrongDocumentError`.

### 2026-11-05 — UI authoring profile rejects `text-overflow`

- Scope: asset (UI importer)
- Reproduction: `text-overflow: clip` in a `.ui.css`.
- Expected/Actual: build fails with `unsupported-css-property`; removed the property (portable profile).
- Status: fixed

### 2026-11-05 — `project check` reports a stale pnpm workspace after any `pnpm install`

- Scope: SDK / template
- Reproduction: `project new --template game-3d`, then any `pnpm install` (here: the Zaohua platform SDK installer adds `file:./vendor/zaohua-platform-sdk`), then `forgeax project check --json`.
- Expected: check passes; the template's `pnpm-workspace.yaml` has no `packages` field.
- Actual: `project-pnpm-workspace-state-stale` — pnpm 12.15 records `workspacePackagePatterns: ["."]` while DevKit compares it with `[]` from the absent field.
- Evidence: `node_modules/.pnpm-workspace-state-v1.json`; DevKit dependency-closure check.
- Status: workaround — declare `packages: ['.']` in `pnpm-workspace.yaml`.

### 2026-11-05 — Static `project preview` has no game inspection bridge

- Scope: runtime / DevKit
- Reproduction: `project build`, `project preview`, then read `globalThis.__forgeaxGameInspection` in the page.
- Expected/Actual: absent by design on the static dist host (only dev hosts install it), so `registerRead` projections are unreadable from a browser driving the built game.
- Status: workaround — with `?qa=1` (or `?dev=1`) the menu mirrors the same `nezha` projection into `data-nezha` on its UI host at ~12 Hz; `qa/harness.cjs` reads the bridge when present, else the mirror.
