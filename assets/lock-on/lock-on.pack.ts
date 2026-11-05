import { definePack } from '@forgeax/engine/pack/source';
import { FixedUpdate, Update } from '@forgeax/engine/ecs';
import type { Plugin } from '@forgeax/engine/plugin';
import { PROPAGATE_TRANSFORMS_SYSTEM, readPresentationWorldMatrix, Transform } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type { CameraService } from '../camera/camera.pack.ts';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { FLOOR_Y, LOCK_TARGET, targetThickness } from '../shared/layout.ts';
import { HEAD_TOP_Y, NEZHA } from '../shared/nezha-shape.ts';
import { resolveGameEntity } from '../shared/scene-refs.ts';
import { axisPoint, closestPoint, facingPivot, keepOutside, lockedVelocity, strikeTest, surfaceDistance, type TargetShape } from './geometry.ts';

type V3 = readonly [number, number, number];

/** The training dummy / lock placeholder as a combat target (M2). */
export interface TargetService {
  readonly entity: import('@forgeax/engine/ecs').EntityHandle;
  readonly shape: () => TargetShape;
  readonly surfaceDistance: (x: number, z: number) => number;
  readonly strike: (x: number, z: number, facing: number, range: number, arcDeg: number) => ReturnType<typeof strikeTest>;
  /** Yaw toward the nearest body point when within `range` and ±90° of facing, else undefined. */
  readonly autoTarget: (x: number, z: number, facing: number, range: number) => number | undefined;
  readonly locked: () => boolean;
  /** Yaw facing the body from (x, z). */
  readonly facingFrom: (x: number, z: number) => number;
  /** Contact distance used to stop the heavy lunge. */
  readonly contactGap: () => number;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    nezhaTarget: TargetService;
  }
}
const r3 = (value: number) => Math.round(value * 1000) / 1000;

/** Project a world point with the camera pose: normalised screen (0..1, top-left) and in-front flag. */
export function project(point: V3, pose: ReturnType<CameraService['pose']>, aspect: number) {
  const [qx, qy, qz, qw] = pose.rotation;
  const px = point[0] - pose.position[0], py = point[1] - pose.position[1], pz = point[2] - pose.position[2];
  // v' = conj(q) * v * q
  const ix = qw * px - qy * pz + qz * py;
  const iy = qw * py - qz * px + qx * pz;
  const iz = qw * pz - qx * py + qy * px;
  const iw = qx * px + qy * py + qz * pz;
  const vx = ix * qw + iw * qx + iy * qz - iz * qy;
  const vy = iy * qw + iw * qy + iz * qx - ix * qz;
  const vz = iz * qw + iw * qz + ix * qy - iy * qx;
  const t = Math.tan(pose.fov / 2);
  const depth = -vz;
  if (depth <= 1e-4) return { x: 0.5, y: 0.5, visible: false };
  return { x: 0.5 + (vx / depth / (t * aspect)) * 0.5, y: 0.5 - (vy / depth / t) * 0.5, visible: true };
}

function box(points: readonly { x: number; y: number; visible: boolean }[]) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  return { ...b, inFrame: points.every((p) => p.visible) && b.minX >= 0 && b.maxX <= 1 && b.minY >= 0 && b.maxY <= 1 };
}

/**
 * Lock-on (R): acquire within `lock.acquireRange` of the body surface, break beyond
 * `lock.breakRange`. While locked, A/D orbit the body, W/S close/open, Nezha faces it,
 * the camera frames both. The placeholder's height/length follow tuning live.
 */
export const lockOn: Plugin = {
  name: 'nezha/lock-on',
  provide: 'nezhaTarget',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer', 'nezhaCamera'],
  apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    const player = ctx.nezhaPlayer as PlayerService | undefined;
    const camera = ctx.nezhaCamera as CameraService | undefined;
    if (!host || !session || !tuning || !telemetry || !player || !camera) throw new Error('nezha/lock-on requires core, player and camera services');
    const targetEntity = resolveGameEntity(world, ctx.gameScene, 'lock-target');

    ctx.effect(function* () {
      let active = false;
      let orbitRadius = 0;
      let lastHint: string | undefined;
      let distance = Infinity;
      let frame = { nezha: { minX: 0, maxX: 0, minY: 0, maxY: 0, inFrame: false }, target: { minX: 0, maxX: 0, minY: 0, maxY: 0, inFrame: false } };
      let applied = { height: -1, length: -1 };

      const shape = (): TargetShape => {
        const l = tuning.current.lock;
        return { cx: LOCK_TARGET.center[0], cz: LOCK_TARGET.center[2], yaw: LOCK_TARGET.yaw, length: l.targetLength, thickness: targetThickness(l.targetHeight), height: l.targetHeight };
      };
      const lookPoint = (): V3 => {
        const s = shape();
        const root = player.root();
        const p = axisPoint(s, root[0], root[2]);
        return [p.x, FLOOR_Y + Math.min(s.height * 0.5, 2.5), p.z];
      };
      const margin = () => tuning.current.move.capsuleRadius + 0.05;
      const raise = (key: 'noTarget' | 'targetLost' | 'locked' | 'unlocked') => {
        lastHint = key;
        session.raiseHint(key);
      };
      const engage = (on: boolean) => {
        active = on;
        if (on) {
          const root = player.root();
          const s = shape();
          const pivot = axisPoint(s, root[0], root[2]);
          orbitRadius = Math.hypot(root[0] - pivot.x, root[2] - pivot.z);
          player.setLock({
            velocity: (x, z, h, v, speed) => {
              const s2 = shape();
              const velocity = lockedVelocity(s2, x, z, h, v, speed, orbitRadius, tuning.current.lock.minOrbitGap);
              if (v !== 0) {
                const p = axisPoint(s2, x, z);
                orbitRadius = Math.hypot(x - p.x, z - p.z);
              }
              return velocity;
            },
            facing: (x, z) => facingPivot(shape(), x, z),
          });
          camera.setLockView({ target: lookPoint });
        } else {
          player.setLock(undefined);
          camera.setLockView(undefined);
        }
      };
      // Locked or not, Nezha cannot hover through the (render-only) placeholder body.
      player.setObstacle((x, z) => keepOutside(shape(), x, z, margin()));
      yield () => player.setObstacle(undefined);
      yield () => engage(false);

      world.addSystem(Update, {
        name: 'nezha-lock-on',
        after: [FixedUpdate],
        before: ['nezha-camera', PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const l = tuning.current.lock;
          if (applied.height !== l.targetHeight || applied.length !== l.targetLength) {
            applied = { height: l.targetHeight, length: l.targetLength };
            world.set(targetEntity, Transform, {
              pos: [LOCK_TARGET.center[0], FLOOR_Y + l.targetHeight / 2, LOCK_TARGET.center[2]],
              scale: [l.targetLength, l.targetHeight, targetThickness(l.targetHeight)],
            }).unwrap();
          }
          const root = player.root();
          distance = surfaceDistance(shape(), root[0], root[2]);
          if (!session.playing()) {
            if (session.phase() === 'title' && active) engage(false);
            return;
          }
          if (player.input().lockPressed) {
            if (active) {
              engage(false);
              raise('unlocked');
            } else if (distance <= l.acquireRange) {
              engage(true);
              raise('locked');
            } else raise('noTarget');
          }
          if (active && distance > l.breakRange) {
            engage(false);
            raise('targetLost');
          }
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-lock-on').unwrap();

      // After the camera has moved: framing proof and the HUD marker.
      world.addSystem(Update, {
        name: 'nezha-lock-frame',
        after: ['nezha-camera'],
        before: ['nezha-core-publish'],
        queries: [],
        fn: () => {
          const pose = camera.pose();
          const size = host.drawingBufferSize?.();
          const aspect = size && size.height > 0 ? size.width / size.height : 16 / 9;
          const matrix = readPresentationWorldMatrix(world, player.entity);
          if (!matrix) return;
          const yaw = Math.atan2(-(matrix[2] ?? 0), matrix[0] ?? 1);
          const c = Math.cos(yaw), s = Math.sin(yaw);
          const model = FLOOR_Y + tuning.current.move.hoverHeight;
          const at = (lx: number, ly: number, lz: number): V3 => [(matrix[12] ?? 0) + lx * c + lz * s, model + ly, (matrix[14] ?? 0) - lx * s + lz * c];
          const tilt = (NEZHA.spearTiltDeg * Math.PI) / 180;
          const above = NEZHA.spearLength - NEZHA.spearBelowGrip;
          const nezhaPoints = [
            at(0, 0, 0), at(-0.25, 0.05, 0), at(0.25, 0.05, 0),
            at(-0.28, 1.3, 0), at(0.3, 1.3, 0), at(0, HEAD_TOP_Y, 0),
            at(NEZHA.grip[0], NEZHA.grip[1] + above * Math.cos(tilt), NEZHA.grip[2] - above * Math.sin(tilt)),
          ].map((p) => project(p, pose, aspect));
          const sh = shape();
          const hl = sh.length / 2, ht = sh.thickness / 2;
          const corners: V3[] = [];
          for (const u of [-hl, hl]) for (const w of [-ht, ht]) for (const y of [0, sh.height]) corners.push([sh.cx + u * Math.cos(sh.yaw) + w * Math.sin(sh.yaw), FLOOR_Y + y, sh.cz - u * Math.sin(sh.yaw) + w * Math.cos(sh.yaw)]);
          frame = { nezha: box(nezhaPoints), target: box(corners.map((p) => project(p, pose, aspect))) };
          const marker = project(lookPoint(), pose, aspect);
          session.contribute({ lock: { active, marker } });
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-lock-frame').unwrap();

      yield ctx.provide('nezhaTarget', {
        entity: targetEntity,
        shape,
        surfaceDistance: (x, z) => surfaceDistance(shape(), x, z),
        strike: (x, z, facing, range, arcDeg) => strikeTest(shape(), x, z, facing, range, arcDeg),
        autoTarget: (x, z, facing, range) => {
          const sh = shape();
          if (surfaceDistance(sh, x, z) > range) return undefined;
          const p = closestPoint(sh, x, z);
          const want = Math.atan2(-(p.x - x), -(p.z - z));
          const diff = Math.atan2(Math.sin(want - facing), Math.cos(want - facing));
          return Math.abs(diff) <= Math.PI / 2 ? want : undefined;
        },
        locked: () => active,
        facingFrom: (x, z) => facingPivot(shape(), x, z),
        contactGap: () => margin() + 0.02,
      } satisfies TargetService);
      yield telemetry.section('lock', () => {
        const s = shape();
        const root = player.root();
        return {
          active,
          distance: r3(distance),
          hint: lastHint ?? null,
          orbitAngleDeg: r3((Math.atan2(root[0] - s.cx, root[2] - s.cz) * 180) / Math.PI),
          target: { height: s.height, length: s.length, thickness: r3(s.thickness) },
          nezhaInFrame: frame.nezha.inFrame,
          nezhaBox: Object.fromEntries(Object.entries(frame.nezha).map(([k, v]) => [k, typeof v === 'number' ? r3(v) : v])),
          targetBox: Object.fromEntries(Object.entries(frame.target).map(([k, v]) => [k, typeof v === 'number' ? r3(v) : v])),
        };
      });
    }, 'nezha/lock-on');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.lockOnPlugin,
  build: () => ok({
    'plugin/lock-on': { kind: 'plugin', module: { specifier: './lock-on.pack.ts', export: 'lockOn' } },
  }),
});
