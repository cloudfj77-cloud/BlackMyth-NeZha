import { definePack } from '@forgeax/engine/pack/source';
import { FixedTime, FixedUpdate, Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { FRAME_START_SCAN_SYSTEM_NAME, INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { quat, vec3 } from '@forgeax/engine/math';
import type { PhysicsWorld } from '@forgeax/engine/physics';
import type { Plugin } from '@forgeax/engine/plugin';
import { readPresentationWorldMatrix, Transform } from '@forgeax/engine/scene';
import { MeshRenderer } from '@forgeax/engine/render';
import type { MeshAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import { cameraRelativeMove, facingYaw } from '../camera/third-person.ts';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import { characterGuid, guidText, materialGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';
import { FLOOR_Y, SPAWN } from '../shared/layout.ts';
import { FEET_Y } from '../shared/nezha-shape.ts';
import { CAPSULE_CENTER_Y } from '../shared/player-rig.ts';
import { resolveGameEntity } from '../shared/scene-refs.ts';
import { createShiftGesture, createVelocityStepper, leanForSpeed, turnToward, type Velocity } from './motion.ts';

export type MoveMode = 'idle' | 'move' | 'sprint';

export interface FrameInput {
  readonly horizontal: number;
  readonly vertical: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly sprint: boolean;
  /** R pressed since the last Update (edge). */
  readonly lockPressed: boolean;
  /** Right mouse held (charging). */
  readonly heavyHeld: boolean;
}

/** Combat edges accumulated across Updates until a fixed step consumes them. */
export interface CombatEdges {
  readonly light: boolean;
  readonly roll: boolean;
  readonly lotus: boolean;
  readonly sash: boolean;
}

/** Per-step movement control from the combat plugin (M2). */
export interface MoveControl {
  /** Velocity override (m/s); undefined = normal stick movement. */
  readonly velocity: Velocity | undefined;
  /** Facing override (yaw), applied instantly. */
  readonly facing: number | undefined;
  readonly speedScale: number;
  readonly allowSprint: boolean;
}

/** Procedural action pose on the model (M2): rotation about a pivot height above the seabed. */
export interface ActionPose {
  readonly rotation: readonly [number, number, number, number];
  /** Pivot height above the seabed (root-local), e.g. 1.0 m for the roll. */
  readonly pivotY: number;
  readonly offset: readonly [number, number, number];
  /** Drop the speed lean while the action plays. */
  readonly suppressLean: boolean;
}

/** Lock-on movement frame (installed by the lock-on plugin in T5). */
export interface LockFrame {
  /** Desired horizontal velocity for the stick input, and the yaw Nezha must face. */
  readonly velocity: (x: number, z: number, horizontal: number, vertical: number, speed: number) => Velocity;
  readonly facing: (x: number, z: number) => number;
  /** Keeps Nezha's root outside the target body (returns a corrected position). */
  readonly clamp?: (x: number, z: number) => { readonly x: number; readonly z: number };
}

export interface PlayerService {
  readonly entity: EntityHandle;
  readonly model: EntityHandle;
  readonly input: () => FrameInput;
  readonly cameraYaw: () => number;
  readonly setCameraYaw: (yaw: number) => void;
  /** Root (judgement) point on the seabed. */
  readonly root: () => readonly [number, number, number];
  readonly speed: () => number;
  readonly mode: () => MoveMode;
  readonly facing: () => number;
  /** Visual-only float offset written by float-fx (T4); 0 until then. */
  readonly setFloat: (offsetY: number, roll: number, pitch: number) => void;
  readonly setLock: (frame: LockFrame | undefined) => void;
  /** Take (and clear) the combat edges collected since the last call. */
  readonly takeEdges: () => CombatEdges;
  /** World-space desired move direction for this step (unit or zero), camera- or lock-relative. */
  readonly moveDirection: () => Velocity;
  readonly setControl: (control: MoveControl | undefined) => void;
  readonly setActionPose: (pose: ActionPose | undefined) => void;
  /** 0..1: how much of the float / sway shows (actions fade it out). */
  readonly setFloatGate: (gate: number) => void;
  readonly floatGate: () => number;
  /** Always-on footprint clamp for render-only bodies (the lock-target placeholder). */
  readonly setObstacle: (clamp: ((x: number, z: number) => { readonly x: number; readonly z: number }) | undefined) => void;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    nezhaPlayer: PlayerService;
  }
}

const IDLE: FrameInput = { horizontal: 0, vertical: 0, lookX: 0, lookY: 0, sprint: false, lockPressed: false, heavyHeld: false };
const NO_EDGES: CombatEdges = { light: false, roll: false, lotus: false, sash: false };
const SAMPLE_SECONDS = 2;

function rotateByQuat(q: readonly number[], v: readonly number[]): [number, number, number] {
  const [qx, qy, qz, qw] = q as [number, number, number, number];
  const [vx, vy, vz] = v as [number, number, number];
  const ix = qw * vx + qy * vz - qz * vy;
  const iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx;
  const iw = -qx * vx - qy * vy - qz * vz;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}
const r3 = (value: number) => Math.round(value * 1000) / 1000;

export const hoverPlayer: Plugin = {
  name: 'nezha/hover-player',
  provide: 'nezhaPlayer',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry'],
  async apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    if (!host || !session || !tuning || !telemetry) throw new Error('nezha/hover-player requires core services');
    const player = resolveGameEntity(world, ctx.gameScene, 'player');
    const model = resolveGameEntity(world, ctx.gameScene, 'player/model');
    const glow = resolveGameEntity(world, ctx.gameScene, 'player/glow');
    // Silhouette review (dev grey mode): every Nezha part takes one mid-grey material.
    const greyParts = [
      { entity: resolveGameEntity(world, ctx.gameScene, 'player/body'), slots: 5 },
      { entity: resolveGameEntity(world, ctx.gameScene, 'player/spear'), slots: 3 },
      { entity: resolveGameEntity(world, ctx.gameScene, 'player/wheels'), slots: 1 },
    ];
    const greyLoaded = await host.assets.load(guidText(materialGuid('grey')), 'material');
    if (!greyLoaded.ok) throw greyLoaded.error;
    const greyMaterial = greyLoaded.value;

    // Silhouette proof is measured from the cooked meshes, not from the authoring constants.
    const measure = async (key: string, axis: 'height' | 'length') => {
      const loaded = await host.assets.load(guidText(characterGuid(key)), 'mesh');
      if (!loaded.ok) throw loaded.error;
      const mesh = host.assets.read(loaded.value).unwrap() as MeshAsset;
      host.assets.release(loaded.value).unwrap();
      const position = mesh.attributes.position as Float32Array;
      let min = Infinity, max = -Infinity;
      for (let index = 1; index < position.length; index += 3) {
        min = Math.min(min, position[index]!);
        max = Math.max(max, position[index]!);
      }
      return axis === 'height' ? max - FEET_Y : max - min;
    };
    const silhouette = { height: r3(await measure('nezha-body', 'height')), spearLength: r3(await measure('nezha-spear', 'length')) };

    await ctx.effect(function* () {
      yield () => host.assets.release(greyMaterial).unwrap();
      let greyApplied = false;
      const shift = createShiftGesture();
      const stepper = createVelocityStepper();
      let frameInput: FrameInput = IDLE;
      let pendingLock = false;
      let cameraYaw = 0;
      let facing = 0;
      let velocity: Velocity = { x: 0, z: 0 };
      let speed = 0;
      let mode: MoveMode = 'idle';
      let lean = 0;
      let floatY = 0, floatRoll = 0, floatPitch = 0;
      let lock: LockFrame | undefined;
      let obstacle: ((x: number, z: number) => { readonly x: number; readonly z: number }) | undefined;
      let taps = 0;
      let edges: { light: boolean; roll: boolean; lotus: boolean; sash: boolean } = { ...NO_EDGES };
      let control: MoveControl | undefined;
      let actionPose: ActionPose | undefined;
      let floatGate = 1;
      let wasLocked = false;
      let leanGate = 1;
      const tmpQ = quat.create();
      const samples: { t: number; speed: number; yaw: number; modelY: number; capsuleY: number; x: number; z: number }[] = [];
      const delta = vec3.create();
      const rotation = quat.create();

      const rootPoint = (): [number, number, number] => {
        const pos = world.get(player, Transform).unwrap().pos;
        return [pos[0] ?? 0, FLOOR_Y, pos[2] ?? 0];
      };

      world.addSystem(Update, {
        name: 'nezha-player-input',
        after: [FRAME_START_SCAN_SYSTEM_NAME],
        before: [FixedUpdate],
        queries: [],
        fn: () => {
          const dt = Math.min(world.getResource(Time).delta, 0.1);
          const snapshot = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          const key = (...codes: string[]) => codes.some((code) => snapshot.keyboard.downCode(code));
          const shiftDown = key('ShiftLeft', 'ShiftRight');
          const gesture = shift.update(shiftDown && session.playing(), dt, tuning.current.move.sprintHoldThreshold);
          if (gesture.tap) taps += 1;
          if (!session.playing()) {
            frameInput = IDLE;
            pendingLock = false;
            return;
          }
          const locked = snapshot.mouse.pointerLocked;
          pendingLock = snapshot.keyboard.justPressedCode('KeyR');
          // Combat edges accumulate until the next fixed step takes them (no press is lost).
          // The click that takes pointer lock is not an attack: only clicks made while already locked count.
          if (locked && wasLocked && snapshot.mouse.justPressed(0)) edges.light = true;
          wasLocked = locked;
          if (snapshot.keyboard.justPressedCode('Space')) edges.roll = true;
          if (snapshot.keyboard.justPressedCode('KeyQ')) edges.lotus = true;
          if (snapshot.keyboard.justPressedCode('Digit1')) edges.sash = true;
          frameInput = {
            horizontal: Number(key('KeyD', 'ArrowRight')) - Number(key('KeyA', 'ArrowLeft')),
            vertical: Number(key('KeyW', 'ArrowUp')) - Number(key('KeyS', 'ArrowDown')),
            lookX: locked ? snapshot.mouse.movementDelta.x : 0,
            lookY: locked ? snapshot.mouse.movementDelta.y : 0,
            sprint: gesture.sprint,
            lockPressed: pendingLock,
            heavyHeld: locked && snapshot.mouse.button(2),
          };
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-player-input').unwrap();

      world.addSystem(FixedUpdate, {
        name: 'nezha-player-movement',
        after: ['nezha-clock', 'nezha-combat'],
        queries: [],
        fn: () => {
          if (!world.hasResource('PhysicsWorld') || !session.playing() || session.clock.frozen()) return;
          const physics = world.getResource<PhysicsWorld>('PhysicsWorld');
          if (!physics.hasBody(player)) return;
          const fixed = world.getResource(FixedTime);
          const dt = fixed.delta;
          const move = tuning.current.move;
          const sprinting = frameInput.sprint && (control?.allowSprint ?? true);
          const top = (sprinting ? move.sprintSpeed : move.walkSpeed) * (control?.speedScale ?? 1);
          const position = world.get(player, Transform).unwrap().pos;
          const px = position[0] ?? 0, pz = position[2] ?? 0;
          let target: Velocity;
          let desiredFacing: number | undefined;
          const stick = Math.hypot(frameInput.horizontal, frameInput.vertical) > 0.1;
          if (lock) {
            target = stick ? lock.velocity(px, pz, frameInput.horizontal, frameInput.vertical, top) : { x: 0, z: 0 };
            desiredFacing = lock.facing(px, pz);
          } else {
            const dir = cameraRelativeMove(cameraYaw, frameInput.horizontal, frameInput.vertical);
            target = { x: dir.x * top, z: dir.z * top };
            if (dir.length > 0.001) desiredFacing = facingYaw(dir.x, dir.z);
          }
          if (control?.velocity) {
            // Actions (attacks, roll, lunge) own the root motion this step; the stick only aims.
            velocity = control.velocity;
            stepper.reset();
            desiredFacing = undefined;
          } else velocity = stepper.step(velocity, target, top, move, dt);
          if (control?.facing !== undefined) facing = control.facing;
          vec3.set(delta, velocity.x * dt, 0, velocity.z * dt);
          const actual = physics.moveAndSlide(player, delta);
          let ax = actual[0] ?? 0, az = actual[2] ?? 0;
          const clamp = lock?.clamp ?? obstacle;
          if (clamp) {
            const after = world.get(player, Transform).unwrap().pos;
            const fixedPos = clamp(after[0] ?? 0, after[2] ?? 0);
            if (Math.abs(fixedPos.x - (after[0] ?? 0)) + Math.abs(fixedPos.z - (after[2] ?? 0)) > 1e-5) {
              physics.teleport(player, vec3.create(fixedPos.x, after[1] ?? CAPSULE_CENTER_Y, fixedPos.z));
              ax += fixedPos.x - (after[0] ?? 0);
              az += fixedPos.z - (after[2] ?? 0);
            }
          }
          speed = Math.hypot(ax, az) / dt;
          // Blocked by a wall: keep velocity consistent with what actually happened.
          if (speed < Math.hypot(velocity.x, velocity.z) - 0.05) velocity = { x: ax / dt, z: az / dt };
          mode = speed < 0.05 && !stick ? 'idle' : sprinting && stick ? 'sprint' : 'move';
          if (desiredFacing !== undefined) facing = turnToward(facing, desiredFacing, move.turnRate, dt);
          const turn = quat.eulerY(facing);
          world.set(player, Transform, { quat: [turn[0] ?? 0, turn[1] ?? 0, turn[2] ?? 0, turn[3] ?? 1] }).unwrap();

          const leanTarget = leanForSpeed(speed, move);
          lean += (leanTarget - lean) * (1 - Math.exp((-3 * dt) / Math.max(0.02, move.leanBlendTime)));

          const now = fixed.tick * dt;
          const after = world.get(player, Transform).unwrap().pos;
          samples.push({
            t: r3(now),
            speed: r3(speed),
            yaw: r3(facing),
            modelY: r3(move.hoverHeight + floatY),
            capsuleY: Math.round((after[1] ?? 0) * 1e5) / 1e5,
            x: r3(after[0] ?? 0),
            z: r3(after[2] ?? 0),
          });
          while (samples.length > 0 && now - samples[0]!.t > SAMPLE_SECONDS) samples.shift();
        },
      }).unwrap();
      yield () => world.removeSystem(FixedUpdate, 'nezha-player-movement').unwrap();

      // Visual model: hover height + lean (+ float from T4). Never touches the root or capsule.
      world.addSystem(Update, {
        name: 'nezha-player-pose',
        after: [FixedUpdate],
        queries: [],
        fn: () => {
          const move = tuning.current.move;
          leanGate += ((actionPose?.suppressLean ? 0 : 1) - leanGate) * (1 - Math.exp(-Math.min(world.getResource(Time).delta, 0.1) * 25));
          const leanRad = (-lean * leanGate * Math.PI) / 180;
          quat.fromEuler(rotation, leanRad + floatPitch, 0, floatRoll, 'YXZ');
          const base: [number, number, number] = [0, -CAPSULE_CENTER_Y + move.hoverHeight + floatY, 0];
          let pos = base;
          if (actionPose) {
            const r = actionPose.rotation;
            tmpQ[0] = r[0]; tmpQ[1] = r[1]; tmpQ[2] = r[2]; tmpQ[3] = r[3];
            const pivot: [number, number, number] = [0, -CAPSULE_CENTER_Y + actionPose.pivotY, 0];
            const rel = [base[0] + actionPose.offset[0] - pivot[0], base[1] + actionPose.offset[1] - pivot[1], base[2] + actionPose.offset[2] - pivot[2]];
            const v = rotateByQuat(r, rel);
            pos = [pivot[0] + v[0], pivot[1] + v[1], pivot[2] + v[2]];
            quat.multiply(rotation, tmpQ, rotation);
          }
          world.set(model, Transform, {
            pos,
            quat: [rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1],
          }).unwrap();
          const grey = session.frontend().grey;
          if (grey !== greyApplied) {
            greyApplied = grey;
            for (const part of greyParts) {
              world.set(part.entity, MeshRenderer, { materials: grey ? Array.from({ length: part.slots }, () => greyMaterial) : [] } as never).unwrap();
            }
          }
          const g = grey ? 0 : tuning.current.glow.radius;
          world.set(glow, Transform, { scale: [g, 1, g] }).unwrap();
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-player-pose').unwrap();

      yield telemetry.section('player', () => {
        const root = rootPoint();
        const capsule = world.get(player, Transform).unwrap().pos;
        const modelMatrix = readPresentationWorldMatrix(world, model);
        return {
          root: root.map(r3),
          capsule: [r3(capsule[0] ?? 0), Math.round((capsule[1] ?? 0) * 1e5) / 1e5, r3(capsule[2] ?? 0)],
          modelOffsetY: modelMatrix ? r3((modelMatrix[13] ?? 0) - FLOOR_Y) : null,
          facingYaw: r3(facing),
          speed: r3(speed),
          mode,
          lean: r3(lean),
          dodgeTaps: taps,
          spawn: SPAWN,
          samples,
        };
      });
      yield telemetry.section('glow', () => {
        // Compare presented poses (both interpolated the same way): the glow must sit exactly on the root.
        const matrix = readPresentationWorldMatrix(world, glow);
        const body = readPresentationWorldMatrix(world, player);
        return {
          pos: matrix ? [r3(matrix[12] ?? 0), r3(matrix[13] ?? 0), r3(matrix[14] ?? 0)] : null,
          offsetFromRoot: matrix && body ? Math.round(Math.hypot((matrix[12] ?? 0) - (body[12] ?? 0), (matrix[14] ?? 0) - (body[14] ?? 0)) * 1e4) / 1e4 : null,
          radius: tuning.current.glow.radius,
          intensity: tuning.current.glow.intensity,
        };
      });
      yield telemetry.section('silhouette', () => ({ ...silhouette, grey: greyApplied }));

      yield ctx.provide('nezhaPlayer', {
        entity: player,
        model,
        input: () => frameInput,
        cameraYaw: () => cameraYaw,
        setCameraYaw: (yaw) => {
          cameraYaw = yaw;
        },
        root: rootPoint,
        speed: () => speed,
        mode: () => mode,
        facing: () => facing,
        setFloat: (offsetY, roll, pitch) => {
          floatY = offsetY;
          floatRoll = roll;
          floatPitch = pitch;
        },
        setLock: (frame) => {
          lock = frame;
        },
        setObstacle: (clamp) => {
          obstacle = clamp;
        },
        takeEdges: () => {
          const taken = edges;
          edges = { ...NO_EDGES };
          return taken;
        },
        moveDirection: () => {
          if (!session.playing()) return { x: 0, z: 0 };
          const dir = cameraRelativeMove(cameraYaw, frameInput.horizontal, frameInput.vertical);
          if (dir.length < 0.1) return { x: 0, z: 0 };
          const n = Math.hypot(dir.x, dir.z) || 1;
          return { x: dir.x / n, z: dir.z / n };
        },
        setControl: (next) => {
          control = next;
        },
        setActionPose: (pose) => {
          actionPose = pose;
        },
        setFloatGate: (gate) => {
          floatGate = gate;
        },
        floatGate: () => floatGate,
      } satisfies PlayerService);
    }, 'nezha/hover-player');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.hoverPlayerPlugin,
  build: () => ok({
    'plugin/hover-player': { kind: 'plugin', module: { specifier: './hover-player.pack.ts', export: 'hoverPlayer' } },
  }),
});
