import { definePack } from '@forgeax/engine/pack/source';
import { FixedUpdate, Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { MeshRenderer } from '@forgeax/engine/render';
import type {} from '@forgeax/engine/assets-runtime';
import type { Plugin } from '@forgeax/engine/plugin';
import { PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type { CameraService } from '../camera/camera.pack.ts';
import type { CombatService } from '../combat/combat.pack.ts';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import { project, type Foe, type TargetService } from '../lock-on/lock-on.pack.ts';
import { qEuler } from '../nezha-rig/rig-def.ts';
import type { SeaService } from '../sea/sea.pack.ts';
import { guidText, materialGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';
import { FLOOR_Y, SPAWN } from '../shared/layout.ts';
import { resolveGameEntity } from '../shared/scene-refs.ts';
import { AMBUSH, LEVEL_SCALE as S, SEA, seaConstrain } from '../shared/sea-layout.ts';
import { createMobs, YAKSHA, type Mob, type MobEvent } from './brain.ts';
import { M_ALERT, M_HURT, M_IDLE, M_STAB, M_WIND, MOB_SLOTS, mobKey, yBlend, yHipY, yJointEuler, yMix, YJOINT_NAMES, type YJoint, type YPose } from './rig-def.ts';

/**
 * 巡海夜叉 on the 陈塘关 boardwalk (v1.4.0 port): two ambush waves (2 + 3) leap from the sea as Nezha
 * crosses each trigger line; clearing both opens the 镇海水门. Passing the 太乙莲台 lights the checkpoint;
 * falling on the road brings her back there (or to the start) with the waves and the gate reset.
 */
export interface MobsService {
  /** Back on the road after a fall: clear the yaksha, shut the gate, return the respawn point. */
  readonly resetRoad: (fresh?: boolean) => { readonly x: number; readonly z: number };
  /** The road is done (dev skip into the fight / retries at the platform): no waves, gate open. */
  readonly skipRoad: () => void;
  /** Yaksha alive now (music, HUD). */
  readonly alive: () => number;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    nezhaMobs: MobsService;
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Plank top: the yaksha stand on the boardwalk (feet at y = 0 in rig space). */
const STAND_Y = FLOOR_Y + 0.05;

export const yaksha: Plugin = {
  name: 'nezha/yaksha',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer', 'nezhaCamera', 'nezhaTarget', 'nezhaCombat', 'nezhaSea'],
  async apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    const player = ctx.nezhaPlayer as PlayerService | undefined;
    const camera = ctx.nezhaCamera as CameraService | undefined;
    const target = ctx.nezhaTarget as TargetService | undefined;
    const combat = ctx.nezhaCombat as CombatService | undefined;
    const sea = ctx.nezhaSea as SeaService | undefined;
    if (!host || !session || !tuning || !telemetry || !player || !camera || !target || !combat || !sea) throw new Error('nezha/yaksha requires core, player, camera, target, combat and sea services');
    const assets = host.assets;
    const warnLoaded = await assets.load(guidText(materialGuid('yaksha-warn')), 'material');
    if (!warnLoaded.ok) throw warnLoaded.error;
    const warnMat = warnLoaded.value;

    // Rig entities (parked under the floor by the scene).
    const slots = Array.from({ length: MOB_SLOTS }, (_, i) => ({
      root: resolveGameEntity(world, ctx.gameScene, mobKey(i)),
      fan: resolveGameEntity(world, ctx.gameScene, `${mobKey(i)}/fan`),
      joints: Object.fromEntries(YJOINT_NAMES.map((j) => [j, resolveGameEntity(world, ctx.gameScene, mobKey(i, j))])) as Record<YJoint, EntityHandle>,
      mob: undefined as Mob | undefined,
      pose: { ...M_IDLE } as YPose,
      phase: 0,
      unregister: undefined as (() => void) | undefined,
    }));

    await ctx.effect(function* () {
      yield () => assets.release(warnMat).unwrap();
      // One warn material copy per fan (its glow pulses on its own).
      const fanMats = slots.map((s) => {
        const copy = assets.copy(warnMat).unwrap();
        world.set(s.fan, MeshRenderer, { materials: [copy] } as never).unwrap();
        return copy;
      });
      yield () => { for (const m of fanMats) assets.release(m).unwrap(); };

      const mobs = createMobs(20261106);
      let wave = 0;
      let lit = false;
      let roadDone = false;
      let lastEvents: string[] = [];
      let stabs = 0, landed = 0;
      const radius = () => tuning.current.move.capsuleRadius;

      const park = (slot: (typeof slots)[number]) => {
        slot.unregister?.();
        slot.unregister = undefined;
        slot.mob = undefined;
        world.set(slot.root, Transform, { pos: [0, -60, 0] }).unwrap();
        world.set(slot.fan, Transform, { scale: [0, 0, 0] }).unwrap();
      };
      const clearAll = () => {
        mobs.clear();
        for (const s of slots) park(s);
      };
      yield clearAll;

      const foeFor = (slot: (typeof slots)[number], m: Mob): Foe => {
        const top = 2.1 * S;
        return {
          id: `yaksha-${m.id}`,
          kind: 'mob',
          targetable: () => m.state !== 'dead' && slot.mob === m,
          surfaceDistance: (x, z) => Math.max(0, Math.hypot(m.x - x, m.z - z) - YAKSHA.radius),
          nearest: () => ({ x: m.x, z: m.z, y: 1.5 }),
          strike: (x, z, facing, range, arcDeg) => {
            const dx = m.x - x, dz = m.z - z;
            const d = Math.hypot(dx, dz);
            const fx = -Math.sin(facing), fz = -Math.cos(facing);
            const angle = d > 1e-4 ? (Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) * 180) / Math.PI : 0;
            const distance = Math.max(0, d - YAKSHA.radius);
            const hit = distance <= range && angle <= arcDeg / 2 + (Math.atan2(YAKSHA.radius, Math.max(d, 1e-3)) * 180) / Math.PI;
            return { hit, distance, angleDeg: angle, point: { x: m.x - (d > 1e-4 ? (dx / d) * YAKSHA.radius : 0), z: m.z - (d > 1e-4 ? (dz / d) * YAKSHA.radius : 0) }, segment: 0, tail: false };
          },
          damage: (amount) => {
            const root = player.root();
            const ev: MobEvent[] = [];
            // Heavy (charged / plunge ≥ 16) always staggers (v1.4.0 lv > 0).
            mobs.damage(m.id, amount, amount >= 16, root[0], root[2], ev);
            for (const e of ev) if (e.type === 'dead') session.emit('growl');
          },
          touching: (x, z) => Math.max(0, Math.hypot(m.x - x, m.z - z) - YAKSHA.radius),
          pushOut: (x, z, margin) => {
            if (m.state === 'dead') return { x, z };
            const dx = x - m.x, dz = z - m.z, d = Math.hypot(dx, dz), want = YAKSHA.radius + margin;
            return d < want && d > 1e-4 ? { x: m.x + (dx / d) * want, z: m.z + (dz / d) * want } : { x, z };
          },
          framePoints: () => [[m.x, STAND_Y, m.z], [m.x, STAND_Y + top, m.z]],
        };
      };

      const spawnWave = (w: number) => {
        AMBUSH[w]!.spawns.forEach(([x, z]) => {
          const slot = slots.find((s) => !s.mob);
          if (!slot) return;
          const m = mobs.spawn(x, z, true);
          m.facing = 0;
          slot.mob = m;
          slot.pose = { ...M_ALERT };
          slot.unregister = target.register(foeFor(slot, m));
        });
        session.emit('splash');
        session.raiseHint(w === 0 ? 'yakshaWave1' : 'yakshaWave2');
      };

      // Fixed step: waves, AI, hits on Nezha, the checkpoint and the gate.
      world.addSystem(FixedUpdate, {
        name: 'nezha-yaksha',
        after: ['nezha-combat'],
        before: ['nezha-player-movement'],
        queries: [],
        fn: () => {
          if (!session.playing()) return;
          const root = player.root();
          const onRoad = root[2] > SEA.gateZ;
          // 太乙莲台: passing within 2.5 m records the checkpoint.
          if (!lit && Math.hypot(root[0] - SEA.lotus[0], root[2] - SEA.lotus[1]) < 2.5 * S + SEA.lotusRadius) {
            lit = true;
            session.emit('checkpoint');
            session.raiseHint('checkpoint');
          }
          if (!roadDone && onRoad && wave < AMBUSH.length && root[2] < AMBUSH[wave]!.z) {
            spawnWave(wave);
            wave += 1;
          }
          const alive = combat.hp() > 0;
          const events = mobs.step({
            nezha: { x: root[0], z: root[2], air: combat.airHeight(), ok: alive && onRoad },
            constrain: (x, z, r) => seaConstrain(x, z, r, { gateOpen: sea.gateOpen(), arenaOnly: false }),
          });
          lastEvents = events.map((e) => e.type);
          for (const e of events) {
            if (e.type === 'alert' || e.type === 'windup') session.emit('growl');
            if (e.type === 'stab') {
              stabs += 1;
              session.emit('mob-swing');
              if (e.hit && alive) {
                landed += 1;
                const dx = root[0] - e.fromX, dz = root[2] - e.fromZ, l = Math.hypot(dx, dz) || 1;
                // Dev lab `frail`: stabs ×10 (QA of the road defeat).
                const scale = tuning.current.difficulty.damageScale * (session.frontend().lab.split(',').includes('frail') ? 10 : 1);
                combat.incoming(Math.round(e.damage * scale), { dir: { x: dx / l, z: dz / l }, distance: 0.6 });
              }
            }
          }
          // Dead and faded: free the slot.
          for (const s of slots) if (s.mob && s.mob.state === 'dead' && s.mob.t > YAKSHA.deadSteps) park(s);
          if (!roadDone && wave >= AMBUSH.length && mobs.alive() === 0) {
            roadDone = true;
            sea.setGate(true);
            session.emit('gate');
            session.raiseHint('gateOpen');
          }
        },
      }).unwrap();
      yield () => world.removeSystem(FixedUpdate, 'nezha-yaksha').unwrap();

      // Every frame: pose the rigs (v1.4.0 blend rates), the fans, and the HUD bars.
      world.addSystem(Update, {
        name: 'nezha-yaksha-view',
        after: ['nezha-camera'],
        before: [PROPAGATE_TRANSFORMS_SYSTEM, 'nezha-core-publish'],
        queries: [],
        fn: () => {
          const dt = Math.min(world.getResource(Time).delta, 0.1) * (session.clock.frozen() ? 0 : 1);
          const pose = camera.pose();
          const size = host.drawingBufferSize?.();
          const aspect = size && size.height > 0 ? size.width / size.height : 16 / 9;
          const bars: { x: number; y: number; hp: number; on: boolean }[] = [];
          slots.forEach((s, i) => {
            const m = s.mob;
            if (!m) return;
            let tgt: YPose = M_IDLE, rate = 12, tilt = 0, shrink = 1;
            const tSec = m.t / 60;
            switch (m.state) {
              case 'patrol': tgt = { ...M_IDLE, tX: 0.35 + Math.sin(tSec * 1.8) * 0.05, hY: Math.sin(tSec * 0.7) * 0.4 }; break;
              case 'alert': tgt = M_ALERT; break;
              case 'attack': {
                const W = YAKSHA.windup, A = YAKSHA.active;
                if (m.t <= W) tgt = yMix(M_IDLE, M_WIND, m.t / W);
                else if (m.t <= W + A) { tgt = M_STAB; rate = 30; }
                else tgt = yMix(M_STAB, M_IDLE, (m.t - W - A) / YAKSHA.recover);
                break;
              }
              case 'hurt': tgt = M_HURT; rate = 20; break;
              case 'dead':
                tgt = M_HURT; rate = 8;
                tilt = -Math.min(1, tSec / 0.6) * 1.4;
                if (tSec > 1) shrink = Math.max(0.01, 1 - (tSec - 1));
                break;
            }
            if (m.walk > 0.2 * S) {
              s.phase += (m.walk / S) * dt * 2.4;
              const sn = Math.sin(s.phase), cs = Math.cos(s.phase);
              tgt = { ...tgt, lhX: -0.4 - sn * 0.5, rhX: 0.2 + sn * 0.5, lkX: 0.7 + Math.max(0, cs) * 0.5, rkX: 0.5 + Math.max(0, -cs) * 0.5 };
            }
            yBlend(s.pose, tgt, 1 - Math.exp(-dt * rate));
            const yaw = m.facing + Math.PI;
            world.set(s.root, Transform, { pos: [m.x, STAND_Y, m.z], quat: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], scale: [S * shrink, S * shrink, S * shrink] }).unwrap();
            world.set(s.joints.model, Transform, { quat: [Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2)] }).unwrap();
            const eul = yJointEuler(s.pose);
            for (const j of YJOINT_NAMES) {
              const e = eul[j];
              if (!e) continue;
              const q = qEuler(e[0], e[1], e[2]);
              world.set(s.joints[j], Transform, j === 'hips' ? { pos: [0, yHipY(s.pose), 0], quat: [q[0], q[1], q[2], q[3]] } : { quat: [q[0], q[1], q[2], q[3]] }).unwrap();
            }
            // Wind-up fan: grows in opacity, flickers in the last 12 steps (v1.4.0 0.25 + 0.4k, +flash).
            const k = mobs.windup(m);
            if (k > 0) {
              const flick = YAKSHA.windup - m.t < 12 ? Math.abs(Math.sin(world.getResource(Time).elapsed * 30)) * 0.3 : 0;
              world.set(s.fan, Transform, { scale: [1, 1, 1] }).unwrap();
              assets.update(fanMats[i]!, { values: { intensity: (0.25 + k * 0.4 + flick) * 1.6 } } as never).unwrap();
            } else world.set(s.fan, Transform, { scale: [0, 0, 0] }).unwrap();
            if (m.state !== 'dead' && m.state !== 'patrol') {
              const p = project([m.x, STAND_Y + 2.25 * S, m.z], pose, aspect);
              bars.push({ x: r3(p.x), y: r3(p.y), hp: r3(m.hp / YAKSHA.hp), on: p.visible });
            }
          });
          session.contribute({ mobs: bars });
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-yaksha-view').unwrap();

      const lotusPoint = { x: SEA.lotusCheckpoint[0], z: SEA.lotusCheckpoint[1] };
      yield ctx.provide('nezhaMobs', {
        resetRoad: (fresh = false) => {
          clearAll();
          if (fresh) lit = false;
          wave = 0;
          roadDone = false;
          sea.setGate(false);
          return lit ? lotusPoint : { x: SPAWN[0], z: SPAWN[2] };
        },
        skipRoad: () => {
          clearAll();
          wave = AMBUSH.length;
          roadDone = true;
          sea.setGate(true);
        },
        alive: () => mobs.alive(),
      } satisfies MobsService);
      // Fresh session: the gate is shut until the waves are cleared.
      sea.setGate(false);

      yield telemetry.section('yaksha', () => ({
        wave,
        lit,
        roadDone,
        alive: mobs.alive(),
        token: mobs.token(),
        stabs,
        landed,
        events: lastEvents,
        mobs: mobs.list().map((m) => ({ id: m.id, state: m.state, t: m.t, hp: r3(m.hp), x: r3(m.x), z: r3(m.z), facing: r3(m.facing) })),
      }));
    }, 'nezha/yaksha');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.yakshaPlugin,
  build: () => ok({
    'plugin/yaksha': { kind: 'plugin', module: { specifier: './yaksha.pack.ts', export: 'yaksha' } },
  }),
});
