import { definePack } from '@forgeax/engine/pack/source';
import { FixedUpdate, Time, Update } from '@forgeax/engine/ecs';
import { quat, vec3 } from '@forgeax/engine/math';
import type { PhysicsWorld } from '@forgeax/engine/physics';
import type { Plugin } from '@forgeax/engine/plugin';
import { Camera } from '@forgeax/engine/render';
import { PROPAGATE_TRANSFORMS_SYSTEM, readPresentationWorldMatrix, Transform } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import { wrapAngle } from '../hover-player/motion.ts';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { CAMERA_RAY_FILTER } from '../shared/collision.ts';
import { CAPSULE_CENTER_Y } from '../shared/player-rig.ts';
import { resolveGameEntity } from '../shared/scene-refs.ts';
import { boomLimit, cameraRight, createBoom, desiredBoom, orbitDirection, wallLift, type V3 } from './rig.ts';

const DEG = Math.PI / 180;
const PROBE_RADIUS = 0.2;
const r3 = (value: number) => Math.round(value * 1000) / 1000;

/** Optional lock-on framing, installed by the lock-on plugin (T5). */
export interface CameraLockView {
  /** World point the camera keeps in frame together with Nezha. */
  readonly target: () => V3;
}

export interface CameraService {
  readonly setLockView: (view: CameraLockView | undefined) => void;
  readonly pose: () => { readonly position: V3; readonly rotation: readonly [number, number, number, number]; readonly fov: number };
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    nezhaCamera: CameraService;
  }
}

export const camera: Plugin = {
  name: 'nezha/camera',
  provide: 'nezhaCamera',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer'],
  apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    const playerService = ctx.nezhaPlayer as PlayerService | undefined;
    if (!host || !session || !tuning || !telemetry || !playerService) throw new Error('nezha/camera requires core and player services');
    const cameraEntity = resolveGameEntity(world, ctx.gameScene, 'camera');
    const player = playerService.entity;

    ctx.effect(function* () {
      let lockAllowed = false;
      host.setPointerLockAllowed?.(false);
      yield () => host.setPointerLockAllowed?.(false);
      let yaw = 0;
      let pitch = tuning.current.camera.pitchDefault * DEG;
      let focus: [number, number, number] | undefined;
      const boom = createBoom(tuning.current.camera.distance);
      let fovApplied = -1;
      let lockView: CameraLockView | undefined;
      let state = {
        position: [0, 0, 0] as V3,
        rotation: [0, 0, 0, 1] as readonly [number, number, number, number],
        distance: 0,
        desired: 0,
        blocked: false,
        lift: 0,
        lineClear: true,
        wallGap: null as number | null,
      };
      const origin = vec3.create();
      const direction = vec3.create();
      const rotation = quat.create();

      const ray = (physics: PhysicsWorld, from: V3, dir: V3, max: number): number | undefined => {
        vec3.set(origin, from[0], from[1], from[2]);
        vec3.set(direction, dir[0], dir[1], dir[2]);
        try {
          return physics.raycast(origin, direction, max, CAMERA_RAY_FILTER)?.timeOfImpact;
        } catch {
          return undefined;
        }
      };

      world.addSystem(Update, {
        name: 'nezha-camera',
        after: [FixedUpdate, 'nezha-player-input', 'nezha-player-pose'],
        before: [PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const dt = Math.min(world.getResource(Time).delta, 0.1);
          const cam = tuning.current.camera;
          const phase = session.phase();
          if ((phase !== 'title') !== lockAllowed) {
            lockAllowed = phase !== 'title';
            host.setPointerLockAllowed?.(lockAllowed);
          }
          if (fovApplied !== cam.fovY) {
            fovApplied = cam.fovY;
            world.set(cameraEntity, Camera, { fov: cam.fovY * DEG }).unwrap();
          }
          const matrix = readPresentationWorldMatrix(world, player);
          if (matrix === undefined) return;
          const groundY = (matrix[13] ?? 0) - CAPSULE_CENTER_Y;
          const locked = lockView !== undefined && phase === 'playing';
          const focusHeight = locked ? cam.focusHeightLocked : cam.focusHeight;
          const target: [number, number, number] = [matrix[12] ?? 0, groundY + focusHeight, matrix[14] ?? 0];
          // Tight horizontal follow (the root already moves smoothly); height follows exactly.
          if (!focus) focus = [...target];
          const follow = 1 - Math.exp(-24 * dt);
          focus = [focus[0] + (target[0] - focus[0]) * follow, target[1], focus[2] + (target[2] - focus[2]) * follow];

          const input = playerService.input();
          const sensitivity = cam.sensitivity * DEG;
          if (locked) {
            // Look along Nezha -> target; the lock-on plugin owns which point that is.
            const goal = lockView!.target();
            const desiredYaw = Math.atan2(goal[0] - target[0], -(goal[2] - target[2]));
            yaw += wrapAngle(desiredYaw - yaw) * (1 - Math.exp(-8 * dt));
            pitch += input.lookY * sensitivity;
          } else if (phase === 'playing') {
            yaw = wrapAngle(yaw + input.lookX * sensitivity);
            pitch += input.lookY * sensitivity;
          }
          pitch = Math.max(cam.pitchMin * DEG, Math.min(cam.pitchMax * DEG, pitch));
          playerService.setCameraYaw(yaw);

          const distance = locked ? cam.distanceLocked : cam.distance;
          const desired = desiredBoom(focus, yaw, pitch, distance, cam.shoulderOffset);
          const hits: (number | undefined)[] = [];
          let ceiling = Infinity;
          let lineClear = true;
          let wallGap: number | null = null;
          if (world.hasResource('PhysicsWorld')) {
            const physics = world.getResource<PhysicsWorld>('PhysicsWorld');
            const right = cameraRight(yaw);
            for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const from: V3 = [focus[0] + right[0] * ox * PROBE_RADIUS, focus[1] + oy * PROBE_RADIUS, focus[2] + right[2] * ox * PROBE_RADIUS];
              hits.push(ray(physics, from, desired.unit, desired.length + 0.5));
            }
            const limit = boomLimit(desired.length, hits, cam.collisionMargin);
            const length = boom.step(limit.limit, cam, dt);
            const end: V3 = [focus[0] + desired.unit[0] * length, focus[1] + desired.unit[1] * length, focus[2] + desired.unit[2] * length];
            const up = ray(physics, end, [0, 1, 0], cam.wallLiftMax + 0.5);
            if (up !== undefined) ceiling = Math.max(0, up - cam.collisionMargin);
            const lift = wallLift(length, cam, ceiling);
            const position: V3 = [end[0], end[1] + lift, end[2]];
            // Proof: nothing solid between Nezha's focus and the lens.
            const toCam: V3 = [position[0] - focus[0], position[1] - focus[1], position[2] - focus[2]];
            const camDistance = Math.hypot(...toCam);
            if (camDistance > 1e-3) {
              const hit = ray(physics, focus, [toCam[0] / camDistance, toCam[1] / camDistance, toCam[2] / camDistance], camDistance);
              lineClear = hit === undefined;
            }
            const nearest = hits.reduce<number | undefined>((min, hit) => (hit === undefined ? min : Math.min(min ?? hit, hit)), undefined);
            if (nearest !== undefined) wallGap = r3(nearest - length);
            // Look at the shoulder pivot (shrinks with the boom so Nezha stays framed when pulled in).
            const shoulder = cam.shoulderOffset * Math.min(1, length / desired.length);
            const lookAt: V3 = locked
              ? [focus[0] + (lockView!.target()[0] - focus[0]) * cam.lockLookAtRatio, focus[1], focus[2] + (lockView!.target()[2] - focus[2]) * cam.lockLookAtRatio]
              : [focus[0] + right[0] * shoulder - desired.unit[0] * 0.01, focus[1], focus[2] + right[2] * shoulder];
            // Free camera looks parallel to the orbit (Nezha left of centre); a lifted camera looks down at him.
            const back = orbitDirection(yaw, pitch);
            const forwardLook: V3 = lift > 0 ? lookAt : [position[0] - back[0], position[1] - back[1], position[2] - back[2]];
            quat.fromLookAt(rotation, position, locked ? lookAt : forwardLook, [0, 1, 0]);
            const q = [rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1] as const;
            world.set(cameraEntity, Transform, { pos: [position[0], position[1], position[2]], quat: [q[0], q[1], q[2], q[3]] }).unwrap();
            state = { position, rotation: q, distance: camDistance, desired: desired.length, blocked: limit.blocked, lift, lineClear, wallGap };
          }
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-camera').unwrap();

      yield telemetry.section('camera', () => ({
        pos: state.position.map(r3),
        yaw: r3(yaw),
        pitch: r3(pitch),
        distance: r3(state.distance),
        desired: r3(state.desired),
        minDistance: tuning.current.camera.minDistance,
        blocked: state.blocked,
        lifted: state.lift > 0,
        lift: r3(state.lift),
        lineClear: state.lineClear,
        wallGap: state.wallGap,
        locked: lockView !== undefined,
      }));
      yield ctx.provide('nezhaCamera', {
        setLockView: (view) => {
          lockView = view;
        },
        pose: () => ({ position: state.position, rotation: state.rotation, fov: tuning.current.camera.fovY * DEG }),
      } satisfies CameraService);
    }, 'nezha/camera');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.cameraPlugin,
  build: () => ok({
    'plugin/camera': { kind: 'plugin', module: { specifier: './camera.pack.ts', export: 'camera' } },
  }),
});
