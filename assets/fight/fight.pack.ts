import { definePack } from '@forgeax/engine/pack/source';
import { FixedUpdate, Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { FRAME_START_SCAN_SYSTEM_NAME, INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import type { Plugin } from '@forgeax/engine/plugin';
import { MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { Transform } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type {} from '@forgeax/engine/assets-runtime';
import type { CameraService, CameraShot } from '../camera/camera.pack.ts';
import type { CombatService } from '../combat/combat.pack.ts';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import { smooth, zoneDistance, zoneHits, type AttackKind } from '../dragon/body.ts';
import { INTRO } from '../dragon/brain.ts';
import type { DragonService } from '../dragon/dragon.pack.ts';
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import type { TargetService } from '../lock-on/lock-on.pack.ts';
import { geometryGuid, guidText, materialGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';
import { ARENA, CANYON, CHECKPOINT, FLOOR_Y, SPAWN } from '../shared/layout.ts';
import type { RunHud } from '../shared/protocol.ts';
import { createRun, RUN, type RunAction, type RunInput } from './run.ts';

const r3 = (value: number) => Math.round(value * 1000) / 1000;
type V3 = readonly [number, number, number];
/** Vortex pattern cross-fade period (s): two phases half a period apart, so the spiral never winds up. */
const VORTEX_PERIOD = 40;
/** Water wall: one turn every 30 s; 20 s in phase 2 (M4 §2), eased in over the 120-step roar. */
const WALL_TURN = 30;
const WALL_TURN_2 = 20;
const BEAM_INTENSITY = 0.35;

/** Intro shots (M4 §1), by intro step. The follow camera takes over at 852 (30-step blend). */
function introShot(k: number, nezha: V3, head: V3): CameraShot {
  if (k < INTRO.flyIn) return { position: [nezha[0], FLOOR_Y + 3.2, nezha[2] + 4.8], look: [nezha[0], FLOOR_Y + 2.2, nezha[2] - 6] };
  if (k < INTRO.orbitEnd) return { position: [0.4, FLOOR_Y + 4.4, 20.2], look: [0, FLOOR_Y + 4.2, -22] };
  if (k < INTRO.sealEnd) return { position: [-2.2, FLOOR_Y + 3.0, 11], look: [0, FLOOR_Y + 4.6, 28] };
  if (k < INTRO.breachEnd) return { position: [-6, FLOOR_Y + 3.6, 13], look: [head[0], head[1], head[2]] };
  if (k < 688) return { position: [2.4, FLOOR_Y + 3.4, 19.4], look: [(nezha[0] + head[0]) / 2, FLOOR_Y + 2.4, (nezha[2] + head[2]) / 2] };
  return { position: [-1.8, FLOOR_Y + 3.4, 11.6], look: [nezha[0], FLOOR_Y + 2.7, nezha[2]] };
}

/** Victory shot (M4 §8): side-on, Nezha and the fallen head both in frame, held through the result. */
function victoryShot(nezha: V3, head: V3): CameraShot {
  let dx = head[0] - nezha[0], dz = head[2] - nezha[2];
  const n = Math.hypot(dx, dz) || 1;
  dx /= n;
  dz /= n;
  const mid = [(nezha[0] + head[0]) / 2, (nezha[2] + head[2]) / 2] as const;
  for (const side of [1, -1]) {
    const pos: [number, number, number] = [mid[0] - dz * 7 * side - dx * 2.5, FLOOR_Y + 3.4, mid[1] + dx * 7 * side - dz * 2.5];
    if (Math.hypot(pos[0], pos[2]) <= 18 || side === -1) return { position: pos, look: [mid[0], FLOOR_Y + 1.5, mid[1]] };
  }
  return { position: [0, FLOOR_Y + 6, 0], look: [mid[0], FLOOR_Y + 1.5, mid[1]] };
}

/**
 * One run of the fight (M4): drives the pure run machine (`run.ts`) and applies it — intro script,
 * hits against the warned zone, phase change, defeat 「败」 / retry, victory and the result, the
 * boss bar, the subtitles, the arena flow (vortex, water wall, the seal) and the run records.
 */
export const fight: Plugin = {
  name: 'nezha/fight',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer', 'nezhaCamera', 'nezhaDragon', 'nezhaTarget', 'nezhaCombat'],
  async apply(ctx) {
    const world = ctx.world;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    const player = ctx.nezhaPlayer as PlayerService | undefined;
    const camera = ctx.nezhaCamera as CameraService | undefined;
    const dragon = ctx.nezhaDragon as DragonService | undefined;
    const target = ctx.nezhaTarget as TargetService | undefined;
    const combat = ctx.nezhaCombat as CombatService | undefined;
    const host = ctx.gameHost;
    if (!host || !session || !tuning || !telemetry || !player || !camera || !dragon || !target || !combat) throw new Error('nezha/fight requires core, player, camera, dragon, target and combat services');

    const assets = host.assets;
    const load = async (guid: string, kind: 'material' | 'mesh') => {
      const loaded = await assets.load(guid, kind);
      if (!loaded.ok) throw loaded.error;
      return loaded.value as never;
    };
    const vortexMat = await load(guidText(materialGuid('vortex')), 'material');
    const wallMat = await load(guidText(materialGuid('water-wall')), 'material');
    const beamMat = await load(guidText(materialGuid('light-beam')), 'material');
    const sealMesh = await load(guidText(geometryGuid('water-seal')), 'mesh');

    await ctx.effect(function* () {
      yield () => {
        for (const h of [vortexMat, wallMat, beamMat, sealMesh]) assets.release(h).unwrap();
      };
      const run = createRun();
      let vortexTime = 0;
      let wallPhase = 0;
      let wallTurn = WALL_TURN;
      let grade = 0;
      let enterPressed = false;
      let pending: string[] = [];
      let step = 0;
      let sealed = false;
      let sealRise = 0;
      let recordSerial = 0;
      let lastRecord: Record<string, unknown> | undefined;
      let lastCause: AttackKind | null = null;
      let defeatAt = -1;
      const history: Record<string, unknown>[] = [];
      const log: { step: number; kind: string; inside: boolean; signed: number; result: string; damage: number }[] = [];
      const actionLog: { step: number; stage: string; type: string }[] = [];
      let bindSeen = combat.bindSerial();

      // The canyon mouth's water seal (M4 §1: rises 300–330 of the intro; the arena stays sealed after).
      const seal: EntityHandle = world.spawn(
        { component: Transform, data: { pos: [0, FLOOR_Y, 0], scale: [1, 0, 1] } },
        { component: MeshFilter, data: { assetHandle: sealMesh } as never },
        { component: MeshRenderer, data: { materials: [wallMat] } as never },
      ).unwrap();
      yield () => world.despawn(seal).unwrap();
      const setSeal = (rise: number) => {
        sealRise = rise;
        world.set(seal, Transform, { scale: [1, Math.max(0, rise), 1] }).unwrap();
      };
      const bounds = (x: number, z: number) => {
        const r = Math.hypot(x, z);
        return r <= ARENA.boundary ? { x, z } : { x: (x / r) * ARENA.boundary, z: (z / r) * ARENA.boundary };
      };
      const setSealed = (on: boolean) => {
        sealed = on;
        player.setBounds(on ? bounds : undefined);
      };
      yield () => player.setBounds(undefined);

      dragon.setEngagedRule(() => {
        const st = run.snapshot().stage;
        return st === 'fight' || st === 'transition';
      });
      yield () => dragon.setEngagedRule(undefined);
      yield () => {
        player.setInputLock(false);
        player.setAutopilot(undefined);
        camera.setScript(undefined, 0);
        session.blockPointerLock(false);
      };

      const toCheckpoint = () => {
        player.teleport(CHECKPOINT[0], CHECKPOINT[2], 0);
        camera.snap(0);
      };
      const record = (outcome: 'defeat' | 'victory') => {
        const r = run.snapshot().records.at(-1)!;
        const usage = combat.usage();
        const d = tuning.current.difficulty;
        const hp = dragon.hp();
        lastRecord = {
          ...r,
          cause: outcome === 'defeat' ? lastCause : null,
          dragonHp: hp.hp,
          dragonHpMax: hp.max,
          dragonPhase: dragon.phase(),
          lotusUsed: usage.lotusMax - usage.lotusLeft,
          sashUsed: usage.binds,
          knobs: { gapMin: d.gapMin, damageScale: d.damageScale, dragonHp: d.dragonHp, lotus: d.lotus },
        };
        history.push(lastRecord);
        while (history.length > 50) history.shift();
        recordSerial += 1;
      };

      const apply = (a: RunAction) => {
        actionLog.push({ step, stage: run.snapshot().stage, type: a.type });
        while (actionLog.length > 24) actionLog.shift();
        switch (a.type) {
          case 'begin-intro':
            dragon.beginIntro();
            player.setInputLock(true);
            target.release();
            camera.snap(0);
            camera.setScript(() => introShot(run.snapshot().k, player.root(), dragon.head()));
            session.emit('intro');
            break;
          case 'skip-intro':
            dragon.skipIntroTo(a.to);
            player.setAutopilot({ velocity: { x: 0, z: 0 }, facing: 0 });
            player.teleport(CHECKPOINT[0], CHECKPOINT[2], 0);
            if (a.to > INTRO.orbitEnd) setSeal(1);
            break;
          case 'intro-end':
            dragon.skipIntroTo(INTRO.end);
            camera.setScript(undefined, 30);
            player.setAutopilot(undefined);
            player.setInputLock(false);
            setSeal(1);
            setSealed(true);
            target.lock();
            break;
          case 'reset':
            combat.reset();
            dragon.reset('fight', run.snapshot().played.transition);
            target.release();
            camera.setScript(undefined, 0);
            toCheckpoint();
            player.setAutopilot(undefined);
            player.setInputLock(false);
            setSeal(1);
            setSealed(true);
            target.lock();
            grade = 0;
            wallTurn = WALL_TURN;
            defeatAt = -1;
            lastCause = null;
            session.emit('reset');
            break;
          case 'to-canyon':
            combat.reset();
            dragon.reset('lurk', run.snapshot().played.transition);
            target.release();
            camera.setScript(undefined, 0);
            player.teleport(SPAWN[0], SPAWN[2], 0);
            camera.snap(0);
            player.setAutopilot(undefined);
            player.setInputLock(false);
            setSeal(0);
            setSealed(false);
            grade = 0;
            wallTurn = WALL_TURN;
            defeatAt = -1;
            break;
          case 'defeat':
            dragon.calm();
            player.setInputLock(true);
            defeatAt = step;
            record('defeat');
            session.emit('defeat');
            break;
          case 'victory': {
            session.clock.ease(RUN.victorySlowmo);
            const shot = victoryShot(player.root(), dragon.head());
            camera.setScript(() => shot);
            player.setInputLock(true);
            player.setAutopilot({ velocity: { x: 0, z: 0 } });
            record('victory');
            session.emit('boss-dead');
            break;
          }
          case 'result':
            session.emit('result');
            break;
        }
      };

      // Enter (skip / retry) is read every frame and consumed by the next fixed step.
      world.addSystem(Update, {
        name: 'nezha-fight-keys',
        after: [FRAME_START_SCAN_SYSTEM_NAME],
        before: [FixedUpdate],
        queries: [],
        fn: () => {
          const snapshot = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          if (session.playing() && (snapshot.keyboard.justPressedCode('Enter') || snapshot.keyboard.justPressedCode('NumpadEnter'))) enterPressed = true;
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-fight-keys').unwrap();

      world.addSystem(FixedUpdate, {
        name: 'nezha-fight',
        after: ['nezha-combat'],
        before: ['nezha-player-movement'],
        queries: [],
        fn: () => {
          pending.push(...session.takeCommands());
          // 「回到标题」 applies at once (the game sits behind the start screen in the canyon).
          if (pending.includes('toTitle')) {
            pending = pending.filter((c) => c !== 'toTitle');
            for (const a of run.step({ toTitle: true })) apply(a);
          }
          if (!session.playing()) return;
          step += 1;
          const input: { -readonly [K in keyof RunInput]: RunInput[K] } = { hurt: 0, perfect: 0 };
          input.retry = pending.includes('retry');
          input.restart = pending.includes('restart');
          pending = [];
          input.enter = enterPressed;
          enterPressed = false;
          const st = run.snapshot().stage;
          // Dev lab: straight into the fight at the checkpoint.
          if (st === 'canyon' && session.frontend().lab.split(',').includes('skipintro')) input.restart = true;
          const root = player.root();
          if (st === 'canyon') input.entered = root[2] < CANYON.zStart + 0.5;
          if (combat.bindSerial() !== bindSeen) {
            bindSeen = combat.bindSerial();
            dragon.bind(combat.bindHoldSteps());
          }
          const radius = tuning.current.move.capsuleRadius;
          const events = dragon.drain();
          // The step the dragon crosses half health, its attack never lands (M4 §2).
          const changing = events.some((e) => e.type === 'phase');
          for (const event of events) {
            if (event.type === 'hit') {
              let result = 'clear';
              const inside = zoneHits(event.zone, root[0], root[2], radius);
              if (inside && st === 'fight' && !changing) {
                const damage = Math.max(1, Math.round(event.damage * tuning.current.difficulty.damageScale));
                const out = combat.incoming(damage, event.knock);
                result = out.type;
                if (out.type === 'hurt' || out.type === 'dead') {
                  input.hurt = (input.hurt ?? 0) + 1;
                  lastCause = event.kind;
                }
                if (out.type === 'perfect') input.perfect = (input.perfect ?? 0) + 1;
                if (out.type === 'dead') input.playerDead = true;
              } else if (changing) result = 'cancelled';
              log.push({ step, kind: event.kind, inside, signed: r3(zoneDistance(event.zone, root[0], root[2])), result, damage: event.damage });
              while (log.length > 16) log.shift();
              if (event.kind === 'coil') session.emit('coil-burst');
            } else if (event.type === 'telegraph') session.emit(`tell-${event.kind}`);
            else if (event.type === 'phase') {
              input.phaseChange = true;
              session.emit('roar');
              session.shake(0.05);
            } else if (event.type === 'transition-end') input.transitionEnd = true;
            else if (event.type === 'dead') input.dragonDead = true;
            else if (event.type === 'breach') {
              session.emit('breach');
              session.shake(0.06);
            }
          }
          for (const a of run.step(input)) apply(a);

          // Per-stage direction.
          const s = run.snapshot();
          if (s.stage === 'intro') {
            if (s.k <= INTRO.flyIn) {
              // Fly in to the fishing lamp in the first second, facing the vortex.
              const left = Math.max(1, INTRO.flyIn - s.k + 1);
              const r = player.root();
              player.setAutopilot({ velocity: { x: ((CHECKPOINT[0] - r[0]) / left) * 60, z: ((CHECKPOINT[2] - r[2]) / left) * 60 }, facing: 0 });
            } else player.setAutopilot({ velocity: { x: 0, z: 0 }, facing: 0 });
            if (s.k >= INTRO.orbitEnd && s.k <= INTRO.sealEnd) setSeal(smooth((s.k - INTRO.orbitEnd) / (INTRO.sealEnd - INTRO.orbitEnd)));
          }
          if (s.stage === 'victory' && s.k >= 270) {
            // 270–300: Nezha turns to the fallen dragon; her float halves.
            const h = dragon.head();
            const r = player.root();
            player.setAutopilot({ velocity: { x: 0, z: 0 }, facing: Math.atan2(-(h[0] - r[0]), -(h[2] - r[2])) });
            combat.setPresentation({ floatScale: 0.5 });
          }
          // Phase-2 grade and water wall (eased over the 120-step roar, back on reset).
          const want = dragon.phase() === 2 || s.stage === 'transition' ? 1 : 0;
          grade += Math.max(-1 / 120, Math.min(1 / 120, want - grade));
          if (s.stage === 'canyon' || s.stage === 'intro') grade = 0;
          wallTurn = WALL_TURN + (WALL_TURN_2 - WALL_TURN) * grade;
          session.setAmbience(1 - 0.2 * grade, 1 - 0.3 * grade);
          // Menus with buttons (defeat banner, result) free the mouse; nothing else may take it.
          session.blockPointerLock(run.defeatBanner() || s.stage === 'result');
        },
      }).unwrap();
      yield () => world.removeSystem(FixedUpdate, 'nezha-fight').unwrap();

      // HUD (every frame): boss bar, run state (subtitle, banners, result), defeat grey.
      world.addSystem(Update, {
        name: 'nezha-fight-hud',
        after: [FixedUpdate],
        before: ['nezha-core-publish'],
        queries: [],
        fn: () => {
          const hp = dragon.hp();
          const s = run.snapshot();
          const line = run.subtitle();
          const runHud: RunHud = {
            stage: s.stage,
            subtitle: line ? { key: line.key, speaker: line.speaker } : null,
            hud: run.hudVisible(),
            banner: run.defeatBanner(),
            desaturate: s.stage === 'defeat',
            skip: run.skipHint(),
            seconds: s.seconds,
            result: s.stage === 'result' && s.result ? { seconds: s.result.seconds, hits: s.result.hits, perfects: s.result.perfects, rating: s.result.rating ?? 'B' } : null,
            recordSerial,
            ...(lastRecord ? { record: lastRecord } : {}),
          };
          session.contribute({
            boss: { hp: hp.hp, hpMax: hp.max, visible: session.playing() && run.hudVisible(), phase: dragon.phase() },
            run: runHud,
          });
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-fight-hud').unwrap();

      // Arena motion (every frame, world clock): only the pattern turns; it stops as the dragon dies.
      world.addSystem(Update, {
        name: 'nezha-arena-flow',
        after: [FixedUpdate],
        queries: [],
        fn: () => {
          if (session.phase() === 'paused') return;
          assets.update(beamMat, { values: { intensity: BEAM_INTENSITY * session.ambience().beams } } as never).unwrap();
          const dt = Math.min(world.getResource(Time).delta, 0.1) * (session.clock.frozen() ? 0 : session.clock.worldScale()) * dragon.vortexSpeed();
          if (dt <= 0) return;
          vortexTime = (vortexTime + dt) % VORTEX_PERIOD;
          wallPhase = (wallPhase + dt / wallTurn) % 1;
          const tb = (vortexTime + VORTEX_PERIOD / 2) % VORTEX_PERIOD;
          const wa = 1 - Math.abs((2 * vortexTime) / VORTEX_PERIOD - 1);
          assets.update(vortexMat, { values: { ta: vortexTime, tb, wa } } as never).unwrap();
          assets.update(wallMat, { values: { phase: wallPhase } } as never).unwrap();
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-arena-flow').unwrap();

      yield telemetry.section('arena', () => ({ vortexTime: r3(vortexTime), wallPhase: r3(wallPhase), wallTurn: r3(wallTurn), grade: r3(grade), vortexSpeed: r3(dragon.vortexSpeed()), sealed, seal: r3(sealRise), ambience: session.ambience() }));
      yield telemetry.section('fight', () => {
        const s = run.snapshot();
        return {
          step,
          stage: s.stage,
          k: s.k,
          timer: s.timer,
          seconds: s.seconds,
          hits: s.hits,
          perfects: s.perfects,
          attempt: s.attempt,
          deaths: s.deaths,
          played: s.played,
          withLines: s.withLines,
          introSkippable: s.introSkippable,
          subtitle: run.subtitle()?.key ?? null,
          banner: run.defeatBanner(),
          controls: run.controls(),
          skip: run.skipHint(),
          result: s.result,
          defeatAt,
          log,
          actions: actionLog,
          history,
          checkpoint: [CHECKPOINT[0], CHECKPOINT[2]],
        };
      });
    }, 'nezha/fight');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.fightPlugin,
  build: () => ok({
    'plugin/fight': { kind: 'plugin', module: { specifier: './fight.pack.ts', export: 'fight' } },
  }),
});
