import { definePack } from '@forgeax/engine/pack/source';
import { FixedUpdate, Time, Update } from '@forgeax/engine/ecs';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type { CameraService } from '../camera/camera.pack.ts';
import type { CombatService } from '../combat/combat.pack.ts';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import { polygonDistance } from '../dragon/body.ts';
import type { DragonService } from '../dragon/dragon.pack.ts';
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import type { TargetService } from '../lock-on/lock-on.pack.ts';
import { guidText, materialGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';
import { CHECKPOINT } from '../shared/layout.ts';

const r3 = (value: number) => Math.round(value * 1000) / 1000;
/** Vortex pattern cross-fade period (s): two phases half a period apart, so the spiral never winds up. */
const VORTEX_PERIOD = 40;
/** Water wall: one turn every 30 s (M3 §2). */
const WALL_TURN = 30;
/** 「败」shows for 60 steps (1 s), then everything resets (M3 §9). */
export const DEFEAT_STEPS = 60;

/**
 * The fight referee (M3): settles the dragon's single-frame hits against Nezha (the whole warned
 * sweep, Nezha's capsule radius included), relays Sash Bind to the dragon, publishes the boss bar,
 * and runs defeat (「败」→ reset) and victory (death → reset).
 */
export const fight: Plugin = {
  name: 'nezha/fight',
  inject: ['world', 'gameHost', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer', 'nezhaCamera', 'nezhaDragon', 'nezhaTarget', 'nezhaCombat'],
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
    const loadMat = async (key: string) => {
      const loaded = await assets.load(guidText(materialGuid(key)), 'material');
      if (!loaded.ok) throw loaded.error;
      return loaded.value as never;
    };
    const vortexMat = await loadMat('vortex');
    const wallMat = await loadMat('water-wall');

    await ctx.effect(function* () {
      yield () => {
        assets.release(vortexMat).unwrap();
        assets.release(wallMat).unwrap();
      };
      let step = 0;
      let vortexTime = 0;
      let wallPhase = 0;
      let bindSeen = combat.bindSerial();
      let defeatLeft = 0;
      let resets = 0;
      let victories = 0;
      let defeats = 0;
      const log: { step: number; kind: string; inside: boolean; signed: number; result: string; damage: number }[] = [];

      const resetAll = () => {
        combat.reset();
        dragon.reset();
        target.release();
        player.teleport(CHECKPOINT[0], CHECKPOINT[2], 0);
        camera.snap(0);
        defeatLeft = 0;
        resets += 1;
        session.emit('reset');
      };

      world.addSystem(FixedUpdate, {
        name: 'nezha-fight',
        after: ['nezha-combat'],
        before: ['nezha-player-movement'],
        queries: [],
        fn: () => {
          if (!session.playing()) return;
          step += 1;
          // Defeat banner runs on real steps (hitstop / slow motion never stretch it).
          if (defeatLeft > 0) {
            defeatLeft -= 1;
            if (defeatLeft === 0) resetAll();
            return;
          }
          if (combat.bindSerial() !== bindSeen) {
            bindSeen = combat.bindSerial();
            dragon.bind(combat.bindHoldSteps());
          }
          const radius = tuning.current.move.capsuleRadius;
          for (const event of dragon.drain()) {
            if (event.type === 'hit') {
              const root = player.root();
              const signed = polygonDistance(event.polygon, root[0], root[2]);
              const inside = signed <= radius;
              let result = 'clear';
              if (inside) {
                const out = combat.incoming(event.damage, event.knock);
                result = out.type;
                if (out.type === 'dead') {
                  defeatLeft = DEFEAT_STEPS;
                  defeats += 1;
                  session.emit('defeat');
                }
              }
              log.push({ step, kind: event.kind, inside, signed: r3(signed), result, damage: event.damage });
              while (log.length > 16) log.shift();
            } else if (event.type === 'dead') {
              victories += 1;
              session.emit('boss-dead');
            } else if (event.type === 'dead-done') {
              resetAll();
            }
          }
        },
      }).unwrap();
      yield () => world.removeSystem(FixedUpdate, 'nezha-fight').unwrap();

      // HUD: boss bar (name + health) while Nezha is in the arena, and the「败」banner.
      world.addSystem(Update, {
        name: 'nezha-fight-hud',
        after: [FixedUpdate],
        before: ['nezha-core-publish'],
        queries: [],
        fn: () => {
          const hp = dragon.hp();
          session.contribute({
            boss: { hp: hp.hp, hpMax: hp.max, visible: session.playing() && (dragon.engaged() || hp.hp < hp.max) },
            ...(defeatLeft > 0 ? { defeat: true } : {}),
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
          const dt = Math.min(world.getResource(Time).delta, 0.1) * (session.clock.frozen() ? 0 : session.clock.worldScale()) * dragon.vortexSpeed();
          if (dt <= 0) return;
          vortexTime = (vortexTime + dt) % VORTEX_PERIOD;
          wallPhase = (wallPhase + dt / WALL_TURN) % 1;
          const tb = (vortexTime + VORTEX_PERIOD / 2) % VORTEX_PERIOD;
          const wa = 1 - Math.abs((2 * vortexTime) / VORTEX_PERIOD - 1);
          assets.update(vortexMat, { values: { ta: vortexTime, tb, wa } } as never).unwrap();
          assets.update(wallMat, { values: { phase: wallPhase } } as never).unwrap();
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-arena-flow').unwrap();

      yield telemetry.section('arena', () => ({ vortexTime: r3(vortexTime), wallPhase: r3(wallPhase), vortexSpeed: r3(dragon.vortexSpeed()) }));
      yield telemetry.section('fight', () => ({ step, defeatLeft, defeats, victories, resets, log, checkpoint: [CHECKPOINT[0], CHECKPOINT[2]] }));
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
