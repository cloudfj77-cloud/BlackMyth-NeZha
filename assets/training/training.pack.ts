import { definePack } from '@forgeax/engine/pack/source';
import { FixedUpdate, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { FRAME_START_SCAN_SYSTEM_NAME, INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import type { Plugin } from '@forgeax/engine/plugin';
import { MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type {} from '@forgeax/engine/assets-runtime';
import type { CombatService } from '../combat/combat.pack.ts';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import { closestPoint } from '../lock-on/geometry.ts';
import type { TargetService } from '../lock-on/lock-on.pack.ts';
import { geometryGuid, guidText, materialGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';
import { FLOOR_Y, LOCK_TARGET, WARN } from '../shared/layout.ts';
import { axisAngle, mulQ } from '../combat/poses.ts';

const r3 = (value: number) => Math.round(value * 1000) / 1000;
const DEG = Math.PI / 180;

/** Training fake attacks (M2): T = line (0.6 s, 10 dmg), Y = 5 m fan (0.9 s, 18 dmg). World clock. */
export const FAKE = Object.freeze({
  line: { steps: 36, damage: 10 },
  fan: { steps: 54, damage: 18 },
});
type FakeKind = keyof typeof FAKE;

/** Is the root (with the capsule radius) inside the warning shape? Shape = damage area (design 4.2). */
export function insideWarning(kind: FakeKind, origin: { x: number; z: number }, yaw: number, x: number, z: number, radius: number): boolean {
  // Into the shape's local frame: forward (-Z) along yaw.
  const dx = x - origin.x, dz = z - origin.z;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  if (kind === 'line') return Math.abs(lx) <= WARN.lineWidth / 2 + radius && lz <= radius && lz >= -WARN.lineLength - radius;
  const d = Math.hypot(lx, lz);
  if (d > WARN.fanRadius + radius) return false;
  if (d <= radius) return true;
  const angle = Math.atan2(lx, -lz);
  const half = (WARN.fanAngleDeg / 2) * DEG;
  // Allow the capsule to overlap the side edges.
  return Math.abs(angle) <= half + Math.asin(Math.min(1, radius / d));
}

/**
 * Training ground: the lock placeholder doubles as an unkillable dummy that sways 3° when hit,
 * fires telegraphed fake attacks (ice-cyan ground warnings that flicker and shrink — the hit
 * frame is the frame the shrink ends), and is wrapped by Sash Bind (everything on it stops).
 */
export const training: Plugin = {
  name: 'nezha/training',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer', 'nezhaTarget', 'nezhaCombat'],
  async apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    const player = ctx.nezhaPlayer as PlayerService | undefined;
    const target = ctx.nezhaTarget as TargetService | undefined;
    const combat = ctx.nezhaCombat as CombatService | undefined;
    if (!host || !session || !tuning || !telemetry || !player || !target || !combat) throw new Error('nezha/training requires core, player, target and combat');
    const assets = host.assets;
    const load = async (guid: string, kind: 'material' | 'mesh') => {
      const loaded = await assets.load(guid, kind);
      if (!loaded.ok) throw loaded.error;
      return loaded.value as never;
    };
    const handles = {
      lineFill: await load(guidText(geometryGuid('warn-line-fill')), 'mesh'),
      lineEdge: await load(guidText(geometryGuid('warn-line-edge')), 'mesh'),
      lineShrink: await load(guidText(geometryGuid('warn-line-shrink')), 'mesh'),
      fanFill: await load(guidText(geometryGuid('warn-fan-fill')), 'mesh'),
      fanEdge: await load(guidText(geometryGuid('warn-fan-edge')), 'mesh'),
      fanShrink: await load(guidText(geometryGuid('warn-fan-shrink')), 'mesh'),
      ring: await load(guidText(geometryGuid('ring')), 'mesh'),
      fill: await load(guidText(materialGuid('warn-fill')), 'material'),
      edge: await load(guidText(materialGuid('warn-edge')), 'material'),
      shrink: await load(guidText(materialGuid('warn-shrink')), 'material'),
      crimson: await load(guidText(materialGuid('bind-crimson')), 'material'),
      gold: await load(guidText(materialGuid('bind-gold')), 'material'),
    };

    await ctx.effect(function* () {
      yield () => {
        for (const handle of Object.values(handles)) assets.release(handle).unwrap();
      };
      const spawned: EntityHandle[] = [];
      const copies: number[] = [];
      yield () => {
        for (const entity of spawned) world.despawn(entity).unwrap();
        for (const c of copies) assets.release(c as never).unwrap();
      };
      const copy = (handle: never) => {
        const c = assets.copy(handle).unwrap() as unknown as number;
        copies.push(c);
        return c as never;
      };
      const make = (meshHandle: never, material: never) => {
        const entity = world.spawn(
          { component: Transform, data: { pos: [0, -50, 0], scale: [0, 0, 0] } },
          { component: MeshFilter, data: { assetHandle: meshHandle } as never },
          { component: MeshRenderer, data: { materials: [material] } as never },
        ).unwrap();
        spawned.push(entity);
        return entity;
      };
      const fillMat = copy(handles.fill);
      const shrinkMat = copy(handles.shrink);
      const warning = {
        line: { fill: make(handles.lineFill, fillMat), edge: make(handles.lineEdge, handles.edge), shrink: make(handles.lineShrink, shrinkMat) },
        fan: { fill: make(handles.fanFill, fillMat), edge: make(handles.fanEdge, handles.edge), shrink: make(handles.fanShrink, shrinkMat) },
      };
      const crimsonMat = copy(handles.crimson);
      const goldMat = copy(handles.gold);
      const bindRings = [0.3, 0.55, 0.8].map((h, i) => ({ h, entity: make(handles.ring, i === 1 ? goldMat : crimsonMat) }));

      let pending: FakeKind | undefined;
      let attack: { kind: FakeKind; origin: { x: number; z: number }; yaw: number; progress: number } | undefined;
      let hold = 0;
      let seenBind = combat.bindSerial();
      let seenHit = combat.hitSerial();
      let sway = 0;
      let swayVel = 0;
      let worldTime = 0;
      const outcomes: { kind: FakeKind; result: string; frame?: number; step: number }[] = [];

      world.addSystem(Update, {
        name: 'nezha-training-input',
        after: [FRAME_START_SCAN_SYSTEM_NAME],
        queries: [],
        fn: () => {
          if (!session.playing()) return;
          const snapshot = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          if (snapshot.keyboard.justPressedCode('KeyT')) pending = 'line';
          if (snapshot.keyboard.justPressedCode('KeyY')) pending = 'fan';
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-training-input').unwrap();

      world.addSystem(FixedUpdate, {
        name: 'nezha-training',
        after: ['nezha-combat'],
        before: ['nezha-player-movement'],
        queries: [],
        fn: () => {
          if (!session.playing()) return;
          const scale = session.clock.worldScale();
          worldTime += scale / 60;
          if (combat.bindSerial() !== seenBind) {
            seenBind = combat.bindSerial();
            hold = combat.bindHoldSteps();
          }
          if (combat.hitSerial() !== seenHit) {
            seenHit = combat.hitSerial();
            if (hold <= 0) swayVel += 3 * DEG * 18;
          }
          if (hold > 0) {
            // Bound: the dummy stops everything (attacks freeze, no new ones, no sway).
            hold -= scale;
            pending = undefined;
            return;
          }
          if (scale === 0) return;
          // Dummy sway: 3° kick, critically damped return (never flashes or shrinks).
          swayVel += (-sway * 120 - swayVel * 18) * (scale / 60);
          sway += swayVel * (scale / 60);
          if (pending && !attack) {
            const root = player.root();
            const shape = target.shape();
            const origin = closestPoint(shape, root[0], root[2]);
            const yaw = Math.atan2(-(root[0] - origin.x), -(root[2] - origin.z));
            attack = { kind: pending, origin, yaw, progress: 0 };
          }
          pending = undefined;
          if (!attack) return;
          attack.progress += scale;
          if (attack.progress >= FAKE[attack.kind].steps) {
            const root = player.root();
            const inside = insideWarning(attack.kind, attack.origin, attack.yaw, root[0], root[2], tuning.current.move.capsuleRadius);
            const result = inside ? combat.incoming(FAKE[attack.kind].damage) : undefined;
            outcomes.push({ kind: attack.kind, result: result?.type ?? 'missed', ...(result && 'frame' in result ? { frame: result.frame } : {}), step: session.clock.snapshot().step });
            while (outcomes.length > 16) outcomes.shift();
            attack = undefined;
          }
        },
      }).unwrap();
      yield () => world.removeSystem(FixedUpdate, 'nezha-training').unwrap();

      world.addSystem(Update, {
        name: 'nezha-training-view',
        after: [FixedUpdate],
        before: [PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const shape = target.shape();
          // Dummy sway (render only).
          world.set(target.entity, Transform, { quat: mulQ(axisAngle([0, 1, 0], LOCK_TARGET.yaw), axisAngle([1, 0, 0], sway)) }).unwrap();
          // Warnings: fill flickers, the cyan edge shrinks from 1.5x onto the deep-blue edge at the hit frame.
          for (const kind of ['line', 'fan'] as const) {
            const w = warning[kind];
            const show = attack?.kind === kind;
            if (!show) {
              for (const e of [w.fill, w.edge, w.shrink]) world.set(e, Transform, { pos: [0, -50, 0], scale: [0, 0, 0] }).unwrap();
              continue;
            }
            const t = Math.min(1, attack!.progress / FAKE[kind].steps);
            const q: [number, number, number, number] = [0, Math.sin(attack!.yaw / 2), 0, Math.cos(attack!.yaw / 2)];
            const pos: [number, number, number] = [attack!.origin.x, FLOOR_Y + 0.035, attack!.origin.z];
            world.set(w.fill, Transform, { pos, quat: q, scale: [1, 1, 1] }).unwrap();
            world.set(w.edge, Transform, { pos: [pos[0], pos[1] + 0.002, pos[2]], quat: q, scale: [1, 1, 1] }).unwrap();
            const k = 1.5 - 0.5 * t;
            world.set(w.shrink, Transform, { pos: [pos[0], pos[1] + 0.004, pos[2]], quat: q, scale: [k, 1, k] }).unwrap();
          }
          if (attack) assets.update(fillMat, { values: { intensity: 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(worldTime * Math.PI * 2 * 6)) } } as never).unwrap();
          // Sash Bind wrap: three rings snap onto the body within 0.2 s and hold.
          const bound = hold > 0;
          const total = combat.bindHoldSteps();
          const wrap = bound ? Math.min(1, (total - hold) / 12) : 0;
          for (const r of bindRings) {
            if (!bound) {
              world.set(r.entity, Transform, { pos: [0, -50, 0], scale: [0, 0, 0] }).unwrap();
              continue;
            }
            const grow = 1 + 0.6 * (1 - wrap);
            world.set(r.entity, Transform, {
              pos: [shape.cx, FLOOR_Y + shape.height * r.h, shape.cz],
              quat: [0, Math.sin(shape.yaw / 2), 0, Math.cos(shape.yaw / 2)],
              scale: [(shape.length / 2 + 0.25) * grow * 1.12, 1, (shape.thickness / 2 + 0.25) * grow * 1.12],
            }).unwrap();
          }
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-training-view').unwrap();

      yield telemetry.section('dummy', () => ({
        attack: attack ? { kind: attack.kind, progress: r3(attack.progress), steps: FAKE[attack.kind].steps, origin: [r3(attack.origin.x), r3(attack.origin.z)], yaw: r3(attack.yaw) } : null,
        bound: hold > 0,
        holdLeft: r3(Math.max(0, hold)),
        swayDeg: r3(sway / DEG),
        outcomes,
      }));
    }, 'nezha/training');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.trainingPlugin,
  build: () => ok({
    'plugin/training': { kind: 'plugin', module: { specifier: './training.pack.ts', export: 'training' } },
  }),
});
