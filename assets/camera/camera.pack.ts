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
import { boomLimit, cameraRight, createBoom, orbitDirection, wallLift, type V3 } from './rig.ts';

const DEG = Math.PI / 180;
const PROBE_RADIUS = 0.2;
const REVIEW_FAR = 30;
/** Boom reach that frames Nezha whole while locked (55° FOV), and the most the camera may rise to keep it. */
const LOCK_FIT_DISTANCE = 2.9;
const LOCK_MAX_LIFT = 2.6;
const r3 = (value: number) => Math.round(value * 1000) / 1000;

/** Optional lock-on framing, installed by the lock-on plugin (T5). */
export interface CameraLockView {
  /** World point the camera keeps in frame together with Nezha. */
  readonly target: () => V3;
  /** M3: extra aim height (m) while the dragon head is above 5 m — the camera tilts up, never pulls back. */
  readonly raise?: () => number;
}

export interface CameraService {
  readonly setLockView: (view: CameraLockView | undefined) => void;
  readonly pose: () => { readonly position: V3; readonly rotation: readonly [number, number, number, number]; readonly fov: number };
  /** Hard cut behind Nezha (defeat / victory reset): yaw, default pitch, focus re-seeded. */
  readonly snap: (yaw: number) => void;
  /**
   * Scripted shots (M4 intro): while set, the lens sits exactly at the returned pose (cuts allowed);
   * on removal the follow camera takes over, blended over `blendSteps` steps.
   */
  readonly setScript: (shot: (() => CameraShot) | undefined, blendSteps?: number) => void;
}

export interface CameraShot {
  readonly position: V3;
  readonly look: V3;
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
      let shakeNow = 0, shakePeak = 0;
      let script: (() => CameraShot) | undefined;
      let blendFrom: { position: V3; rotation: readonly [number, number, number, number] } | undefined;
      let blendLeft = 0, blendTotal = 1;
      let aimRaise = 0;
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
      let airFollow = 0;
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
          const allow = phase !== 'title' && !session.pointerLockBlocked();
          if (allow !== lockAllowed) {
            lockAllowed = allow;
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
          // Jumps (v1.4.0): the aim rises 75 % of the jump height, smoothed (rate 6/s) so the camera does not bob.
          airFollow += (playerService.airLift() - airFollow) * (1 - Math.exp(-6 * dt));
          const target: [number, number, number] = [matrix[12] ?? 0, groundY + focusHeight + airFollow * 0.75, matrix[14] ?? 0];
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

          // Dev review camera (?dev=1&lab=far30): silhouette check from 30 m.
          const far = session.frontend().lab === 'far30';
          const distance = far ? REVIEW_FAR : locked ? cam.distanceLocked : cam.distance;
          const right = cameraRight(yaw);
          const back = orbitDirection(yaw, pitch);
          const hits: (number | undefined)[] = [];
          let lineClear = true;
          let wallGap: number | null = null;
          if (world.hasResource('PhysicsWorld')) {
            const physics = world.getResource<PhysicsWorld>('PhysicsWorld');
            // 1) Shoulder: probe sideways so the 0.6 m offset survives a pull-in (only a side wall shortens it).
            const side = ray(physics, focus, right, cam.shoulderOffset + cam.collisionMargin);
            const shoulder = Math.max(0, Math.min(cam.shoulderOffset, side === undefined ? Infinity : side - cam.collisionMargin));
            const pivot: V3 = [focus[0] + right[0] * shoulder, focus[1], focus[2] + right[2] * shoulder];
            // 2) Boom: probe a small bundle from the shoulder pivot straight back along the orbit.
            for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const from: V3 = [pivot[0] + right[0] * ox * PROBE_RADIUS, pivot[1] + oy * PROBE_RADIUS, pivot[2] + right[2] * ox * PROBE_RADIUS];
              hits.push(ray(physics, from, back, distance + 0.5));
            }
            const limit = boomLimit(distance, hits, cam.collisionMargin);
            const length = boom.step(limit.limit, cam, dt);
            const end: V3 = [pivot[0] + back[0] * length, pivot[1] + back[1] * length, pivot[2] + back[2] * length];
            // 3) Back to the wall: rise up the wall until the lens is ≥ minDistance from the focus.
            const up = ray(physics, end, [0, 1, 0], cam.wallLiftMax + 0.5);
            const ceiling = up === undefined ? Infinity : Math.max(0, up - cam.collisionMargin);
            const reach = Math.hypot(shoulder, length);
            // Locked framing must keep Nezha whole (feet to spear tip ≈ 2.8 m): if a wall shortens the boom
            // below the fit distance, rise further up the wall and look down at him (capped by the ceiling).
            const fitLift = locked && reach < LOCK_FIT_DISTANCE ? Math.min(LOCK_MAX_LIFT, ceiling, Math.sqrt(LOCK_FIT_DISTANCE ** 2 - reach ** 2)) : 0;
            const lift = Math.max(wallLift(reach, cam, ceiling), fitLift);
            // Hit shake (real time, after collision so it never pushes into a wall): 25 Hz, linear decay.
            const impulse = session.shakeImpulse();
            const now = world.getResource(Time).elapsed;
            const age = now - impulse.at;
            const decay = tuning.current.combat.shakeDecay;
            const amp = impulse.at >= 0 && age < decay ? impulse.amplitude * (1 - age / decay) : 0;
            const phase = 2 * Math.PI * tuning.current.combat.shakeHz * Math.max(0, age);
            const shakeOffset: V3 = [right[0] * amp * Math.sin(phase), amp * Math.cos(phase * 1.3), right[2] * amp * Math.sin(phase)];
            shakeNow = amp;
            shakePeak = Math.max(shakePeak, amp);
            const position: [number, number, number] = [end[0] + shakeOffset[0], end[1] + lift + shakeOffset[1], end[2] + shakeOffset[2]];
            const toCam: V3 = [position[0] - focus[0], position[1] - focus[1], position[2] - focus[2]];
            const camDistance = Math.hypot(...toCam);
            if (camDistance > 1e-3) {
              const hit = ray(physics, focus, [toCam[0] / camDistance, toCam[1] / camDistance, toCam[2] / camDistance], camDistance);
              lineClear = hit === undefined;
            }
            const nearest = hits.reduce<number | undefined>((min, hit) => (hit === undefined ? min : Math.min(min ?? hit, hit)), undefined);
            if (nearest !== undefined) wallGap = r3(nearest - length);
            let lookAt: V3;
            // Head above 5 m: raise the aim only (smoothed ~0.2 s), distance and height untouched.
            const raiseGoal = locked ? Math.max(0, lockView!.raise?.() ?? 0) : 0;
            aimRaise += (raiseGoal - aimRaise) * (1 - Math.exp(-dt / 0.07));
            if (locked) {
              const goal = lockView!.target();
              const free: V3 = [focus[0] + (goal[0] - focus[0]) * cam.lockLookAtRatio, focus[1], focus[2] + (goal[2] - focus[2]) * cam.lockLookAtRatio];
              // Lifted: pull the aim back onto Nezha's chest so the whole body stays in frame.
              const blend = Math.min(1, lift / 1.2);
              const chest: V3 = [focus[0], groundY + 1.0, focus[2]];
              lookAt = [free[0] + (chest[0] - free[0]) * blend, free[1] + (chest[1] - free[1]) * blend + aimRaise, free[2] + (chest[2] - free[2]) * blend];
            } else if (lift > 0) {
              // Lifted: look down over the shoulder at the chest, so body, wheels and glow stay in frame.
              const blend = Math.min(1, lift / Math.max(0.05, cam.wallLiftMax));
              const chest = groundY + 0.9;
              const ahead = 0.6 * blend;
              const fwd: V3 = [-back[0], 0, -back[2]];
              const n = Math.hypot(fwd[0], fwd[2]) || 1;
              lookAt = [focus[0] + (fwd[0] / n) * ahead, focus[1] + (chest - focus[1]) * blend, focus[2] + (fwd[2] / n) * ahead];
            } else {
              // Free camera looks parallel to the orbit, Nezha left of centre.
              lookAt = [position[0] - back[0], position[1] - back[1], position[2] - back[2]];
            }
            quat.fromLookAt(rotation, position, lookAt, [0, 1, 0]);
            let q = [rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1] as readonly [number, number, number, number];
            if (script) {
              // Scripted shot: exact pose (the follow rig keeps tracking underneath for the hand-back).
              const shot = script();
              quat.fromLookAt(rotation, shot.position, shot.look, [0, 1, 0]);
              const sq = [rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1] as const;
              world.set(cameraEntity, Transform, { pos: [...shot.position], quat: [sq[0], sq[1], sq[2], sq[3]] }).unwrap();
              blendFrom = { position: shot.position, rotation: sq };
              state = { position: shot.position, rotation: sq, distance: camDistance, desired: Math.hypot(cam.shoulderOffset, distance), blocked: limit.blocked, lift, lineClear, wallGap };
              return;
            }
            if (blendFrom && blendLeft > 0) {
              blendLeft = Math.max(0, blendLeft - dt * 60);
              const w0 = 1 - blendLeft / blendTotal;
              const w = w0 * w0 * (3 - 2 * w0);
              position[0] = blendFrom.position[0] + (position[0] - blendFrom.position[0]) * w;
              position[1] = blendFrom.position[1] + (position[1] - blendFrom.position[1]) * w;
              position[2] = blendFrom.position[2] + (position[2] - blendFrom.position[2]) * w;
              const a = blendFrom.rotation;
              const sign = a[0] * q[0] + a[1] * q[1] + a[2] * q[2] + a[3] * q[3] < 0 ? -1 : 1;
              const m = [a[0] + (q[0] * sign - a[0]) * w, a[1] + (q[1] * sign - a[1]) * w, a[2] + (q[2] * sign - a[2]) * w, a[3] + (q[3] * sign - a[3]) * w];
              const n = Math.hypot(...m) || 1;
              q = [m[0]! / n, m[1]! / n, m[2]! / n, m[3]! / n];
            }
            world.set(cameraEntity, Transform, { pos: [position[0], position[1], position[2]], quat: [q[0], q[1], q[2], q[3]] }).unwrap();
            state = { position, rotation: q, distance: camDistance, desired: Math.hypot(cam.shoulderOffset, distance), blocked: limit.blocked, lift, lineClear, wallGap };
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
        aimRaise: r3(aimRaise),
        focusY: focus ? r3(focus[1] - ((readPresentationWorldMatrix(world, player)?.[13] ?? 0) - CAPSULE_CENTER_Y)) : null,
        lineClear: state.lineClear,
        wallGap: state.wallGap,
        locked: lockView !== undefined,
        shake: r3(shakeNow),
        shakePeak: r3(shakePeak),
      }));
      yield ctx.provide('nezhaCamera', {
        setLockView: (view) => {
          lockView = view;
        },
        pose: () => ({ position: state.position, rotation: state.rotation, fov: tuning.current.camera.fovY * DEG }),
        setScript: (shot, blendSteps = 30) => {
          if (!shot && script) {
            blendLeft = blendTotal = Math.max(1, blendSteps);
          }
          script = shot;
        },
        snap: (nextYaw) => {
          yaw = nextYaw;
          pitch = tuning.current.camera.pitchDefault * DEG;
          focus = undefined;
          playerService.setCameraYaw(yaw);
        },
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
