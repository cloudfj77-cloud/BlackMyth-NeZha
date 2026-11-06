import { definePack } from '@forgeax/engine/pack/source';
import { FixedTime, FixedUpdate, Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createMeshBuilder, packInterleavedVertexAttributes } from '@forgeax/engine/geometry';
import type { Plugin } from '@forgeax/engine/plugin';
import { DirectionalLight, Fog, MeshFilter, MeshRenderer, Points, PointShapeValue, PointSizeUnitsValue, Skylight } from '@forgeax/engine/render';
import { ChildOf, PROPAGATE_TRANSFORMS_SYSTEM, readPresentationWorldMatrix, Transform } from '@forgeax/engine/scene';
import type { MeshAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type {} from '@forgeax/engine/assets-runtime';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import { WATER_HORIZON } from '../environment.pack.ts';
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import type { TargetService } from '../lock-on/lock-on.pack.ts';
import { characterGuid, geometryGuid, guidText, materialGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';
import { FLOOR_Y } from '../shared/layout.ts';
import { WHEEL_FULL_INTENSITY } from '../shared/palette.ts';
import { NEZHA } from '../shared/nezha-shape.ts';
import { CAPSULE_CENTER_Y } from '../shared/player-rig.ts';
import { resolveGameEntity } from '../shared/scene-refs.ts';
import { configFromTuning, createCombat, DEFAULT_COMBAT, type CombatEvent, type CombatState, type V2 } from './machine.ts';
import { actionVisual, RIGGED, spearQuat, SPEAR_REST, type P3, type Q } from './poses.ts';

interface Shown {
  readonly rotation: Q;
  readonly spearQuat: Q;
  readonly spearPos: P3;
  readonly offset: P3;
  readonly pivotY: number;
}
function nlerp(a: Q, b: Q, t: number): Q {
  const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const q: Q = [a[0] + (b[0] * sign - a[0]) * t, a[1] + (b[1] * sign - a[1]) * t, a[2] + (b[2] * sign - a[2]) * t, a[3] + (b[3] * sign - a[3]) * t];
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
const mix3 = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function mixShown(a: Shown, b: Shown, t: number): Shown {
  return { rotation: nlerp(a.rotation, b.rotation, t), spearQuat: nlerp(a.spearQuat, b.spearQuat, t), spearPos: mix3(a.spearPos, b.spearPos, t), offset: mix3(a.offset, b.offset, t), pivotY: a.pivotY + (b.pivotY - a.pivotY) * t };
}

const r3 = (value: number) => Math.round(value * 1000) / 1000;
const STEP_S = 1 / 60;
const SPARKS = 16;
/** Wheel fire glow (matches material/wheel-fire: WHEEL_FULL_INTENSITY × 0.3). */
const WHEEL_FIRE = 0.3 * WHEEL_FULL_INTENSITY;
const SPEAR_ABOVE_GRIP = NEZHA.spearLength - NEZHA.spearBelowGrip;

export interface CombatService {
  /** An enemy hit lands now (call after the combat step). Returns what happened. */
  readonly incoming: (damage: number, knockback?: { readonly dir: V2; readonly distance: number }) => CombatEvent;
  /** Fresh fight: full HP / stamina / seeds, sash ready, standing free. */
  readonly reset: () => void;
  readonly hp: () => number;
  /** Current action (the sash reels in during a roll). */
  readonly action: () => string;
  /** The action as presented this frame (interpolated frame), for the jointed rig. */
  readonly pose: () => { readonly kind: string; readonly frame: number; readonly stage: number; readonly charge: number; readonly wheelsFull: boolean; readonly airY: number; readonly airVy: number; readonly boost: number };
  /** Jump height above the hover line (m) — jumpable attacks miss above JUMP_CLEAR. */
  readonly airHeight: () => number;
  /** M4 presentation overrides: float scale (victory: half). */
  readonly setPresentation: (p: { readonly floatScale?: number }) => void;
  /** Lotus seeds left, Sash Binds used since the last reset (run records). */
  readonly usage: () => { readonly lotusLeft: number; readonly lotusMax: number; readonly binds: number };
  /** Bumped on every landed player hit (dummy reaction). */
  readonly hitSerial: () => number;
  /** Bumped when Sash Bind takes hold. */
  readonly bindSerial: () => number;
  readonly sashCooldown: () => { readonly left: number; readonly total: number };
  readonly bindHoldSteps: () => number;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    nezhaCombat: CombatService;
  }
}

function sparkCloud(): MeshAsset {
  const position = new Float32Array(SPARKS * 3);
  const normal = new Float32Array(SPARKS * 3);
  const tangent = new Float32Array(SPARKS * 4);
  for (let i = 0; i < SPARKS; i += 1) {
    normal[i * 3 + 2] = 1;
    tangent[i * 4] = 1;
    tangent[i * 4 + 3] = 1;
  }
  const attributes = { position, normal, uv: new Float32Array(SPARKS * 2), tangent };
  const packed = packInterleavedVertexAttributes(attributes, SPARKS);
  if (!packed.ok) throw packed.error;
  return {
    kind: 'mesh',
    vertices: packed.value.vertices,
    attributes,
    aabb: new Float32Array([-1.5, -1.5, -1.5, 1.5, 1.5, 1.5]),
    submeshes: [{ indexOffset: 0, indexCount: 0, vertexCount: SPARKS, topology: 'point-list', materialSlot: 0 }],
    materialSlots: [{ slotName: 'sparks' }],
  };
}

function quatFromMatrix(m: ArrayLike<number>): [number, number, number, number] {
  const m00 = m[0]!, m01 = m[4]!, m02 = m[8]!, m10 = m[1]!, m11 = m[5]!, m12 = m[9]!, m20 = m[2]!, m21 = m[6]!, m22 = m[10]!;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

/**
 * Nezha's combat (M2): drives the pure state machine once per un-frozen fixed step, owns the
 * hitstop / slow-motion requests, and presents the actions on the rigid greybox (procedural
 * poses, spear-tip flame, sparks, afterimages, perfect-dodge ring, wheel states).
 */
export const combat: Plugin = {
  name: 'nezha/combat',
  provide: 'nezhaCombat',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer', 'nezhaTarget'],
  async apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    const player = ctx.nezhaPlayer as PlayerService | undefined;
    const target = ctx.nezhaTarget as TargetService | undefined;
    if (!host || !session || !tuning || !telemetry || !player || !target) throw new Error('nezha/combat requires core, player and target services');
    const assets = host.assets;
    const scene = ctx.gameScene;
    const spear = resolveGameEntity(world, scene, 'player/spear');
    const wheels = [resolveGameEntity(world, scene, 'player/rig/l-wheel'), resolveGameEntity(world, scene, 'player/rig/r-wheel')];
    RIGGED.on = true;
    const sun = resolveGameEntity(world, scene, 'sun');
    const skylight = resolveGameEntity(world, scene, 'skylight');
    const fog = resolveGameEntity(world, scene, 'fog');
    const sunBase = world.get(sun, DirectionalLight).unwrap();
    const skyBase = world.get(skylight, Skylight).unwrap();
    const sunIntensity = sunBase.intensity, skyIntensity = skyBase.intensity;
    const sunColor = Array.from(sunBase.color as ArrayLike<number>);

    const load = async (guid: string, kind: 'material' | 'mesh') => {
      const loaded = await assets.load(guid, kind);
      if (!loaded.ok) throw loaded.error;
      return loaded.value as never;
    };
    const mat = {
      wheel: await load(guidText(materialGuid('wheel-fire')), 'material'),
      wheelGold: await load(guidText(materialGuid('nz-gold')), 'material'),
      wheelRed: await load(guidText(materialGuid('nz-red')), 'material'),
      wheelFull: await load(guidText(materialGuid('wheel-fire-full')), 'material'),
      afterimage: await load(guidText(materialGuid('afterimage-cloud')), 'material'),
      ring: await load(guidText(materialGuid('perfect-ring')), 'material'),
      spark: await load(guidText(materialGuid('spark')), 'material'),
      flame: await load(guidText(materialGuid('flame')), 'material'),
    };
    const mesh = {
      body: await load(guidText(characterGuid('nezha-body')), 'mesh'),
      ring: await load(guidText(geometryGuid('ring')), 'mesh'),
      flame: await load(guidText(geometryGuid('flame')), 'mesh'),
    };

    await ctx.effect(function* () {
      yield () => {
        for (const handle of [...Object.values(mat), ...Object.values(mesh)]) assets.release(handle).unwrap();
      };
      const config = () => {
        const c = configFromTuning(tuning.current.combat);
        return { ...c, lotus: { ...c.lotus, count: Math.round(tuning.current.difficulty.lotus) } };
      };
      const machine = createCombat(config());
      let floatScale = 1;
      let bindsSinceReset = 0;
      let deadFor = -1;
      let wheelFire: unknown;
      let wheelGlow = -1;
      let configRevision = tuning.revision();
      let hitSerial = 0, bindSerial = 0, hurtSerial = 0;
      const hitLog: { step: number; kind: string; stage: number; dmg: number; dist: number; ang: number; segment: number; tail: boolean; hitstop: number; shake: number }[] = [];
      const incomingLog: { step: number; result: string; frame?: number; damage: number }[] = [];
      let state: CombatState = { kind: 'free', frame: 0, stage: 0, charge: 0, rollDir: { x: 0, z: 0 } };
      let floatGate = 1;
      let wheelsFull = false;
      let flameEnd: P3 | null = null;

      // --- Runtime presentation entities -------------------------------------------------
      const spawned: EntityHandle[] = [];
      const copies: number[] = [];
      yield () => {
        for (const entity of spawned) world.despawn(entity).unwrap();
        for (const copy of copies) assets.release(copy as never).unwrap();
      };
      const copy = (handle: never) => {
        const c = assets.copy(handle).unwrap() as unknown as number;
        copies.push(c);
        return c as never;
      };
      const flame = world.spawn(
        { component: Transform, data: { pos: [0, SPEAR_ABOVE_GRIP, 0], scale: [0, 0, 0] } },
        { component: ChildOf, data: { parent: spear } },
        { component: MeshFilter, data: { assetHandle: mesh.flame } as never },
        { component: MeshRenderer, data: { materials: [mat.flame] } as never },
      ).unwrap();
      spawned.push(flame);
      const AFTER_FRAMES = [1, 4, 7, 10, 13];
      // All five afterimages live in ONE mesh (M4 §12: separately drawn ghosts cost 5 draw calls each
      // and caused the draw spikes). Each slot bakes the body's pose when it spawns; its fade rides in
      // uv0.x. One draw for the whole trail.
      const body = assets.read(mesh.body).unwrap() as MeshAsset;
      const bodyPos = body.attributes.position as Float32Array;
      const bodyNor = (body.attributes.normal as Float32Array | undefined) ?? new Float32Array(bodyPos.length);
      const bodyVerts = bodyPos.length / 3;
      const bodyIdx: number[] = [];
      const srcIdx = body.indices as Uint32Array | Uint16Array | undefined;
      for (const sm of body.submeshes) for (let k = 0; k < sm.indexCount; k += 1) bodyIdx.push((srcIdx?.[sm.indexOffset + k] ?? 0) + ((sm as { baseVertex?: number }).baseVertex ?? 0));
      const cloudIdx = new Uint32Array(bodyIdx.length * AFTER_FRAMES.length);
      AFTER_FRAMES.forEach((_, s) => bodyIdx.forEach((v, k) => (cloudIdx[s * bodyIdx.length + k] = v + s * bodyVerts)));
      const cloudPos = new Float32Array(bodyVerts * 3 * AFTER_FRAMES.length);
      for (let v = 0; v < cloudPos.length; v += 3) cloudPos[v + 1] = -50;
      const cloudNor = new Float32Array(cloudPos.length);
      const cloudUv = new Float32Array(bodyVerts * 2 * AFTER_FRAMES.length);
      const cloudBuilt = createMeshBuilder({
        attributes: { position: cloudPos, normal: cloudNor, uv: cloudUv },
        indices: cloudIdx,
        submeshes: [{ indexOffset: 0, indexCount: cloudIdx.length, vertexCount: bodyVerts * AFTER_FRAMES.length, topology: 'triangle-list', materialSlot: 0 }],
        materialSlots: [{ slotName: 'afterimages' }],
      }).build();
      if (!cloudBuilt.ok) throw cloudBuilt.error;
      const cloudMesh = assets.create({ ...cloudBuilt.value, aabb: new Float32Array([-60, -60, -60, 60, 30, 60]) }).unwrap();
      yield () => {
        assets.release(cloudMesh).unwrap();
      };
      const cloud = world.spawn(
        { component: Transform, data: { pos: [0, 0, 0] } },
        { component: MeshFilter, data: { assetHandle: cloudMesh } as never },
        { component: MeshRenderer, data: { materials: [mat.afterimage] } as never },
      ).unwrap();
      spawned.push(cloud);
      const afterimages = AFTER_FRAMES.map(() => ({ life: 0 }));
      let cloudLive = false;
      let perfectSerial = 0;
      let cyanLeft = 0;
      /** Bake the body at matrix m into slot s (world space). */
      const bakeSlot = (s: number, m: ArrayLike<number>) => {
        const o = s * bodyVerts * 3;
        for (let v = 0; v < bodyVerts; v += 1) {
          const x = bodyPos[v * 3]!, y = bodyPos[v * 3 + 1]!, z = bodyPos[v * 3 + 2]!;
          cloudPos[o + v * 3] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
          cloudPos[o + v * 3 + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
          cloudPos[o + v * 3 + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
          const nx = bodyNor[v * 3]!, ny = bodyNor[v * 3 + 1]!, nz = bodyNor[v * 3 + 2]!;
          cloudNor[o + v * 3] = m[0]! * nx + m[4]! * ny + m[8]! * nz;
          cloudNor[o + v * 3 + 1] = m[1]! * nx + m[5]! * ny + m[9]! * nz;
          cloudNor[o + v * 3 + 2] = m[2]! * nx + m[6]! * ny + m[10]! * nz;
        }
        assets.writeRange(cloudMesh, { attribute: 'position', first: s * bodyVerts, values: cloudPos.subarray(o, o + bodyVerts * 3) }).unwrap();
        assets.writeRange(cloudMesh, { attribute: 'normal', first: s * bodyVerts, values: cloudNor.subarray(o, o + bodyVerts * 3) }).unwrap();
      };
      const fadeSlot = (s: number, fade: number) => {
        const o = s * bodyVerts * 2;
        for (let v = 0; v < bodyVerts; v += 1) cloudUv[o + v * 2] = fade;
      };
      assets.update(mat.afterimage, { values: { intensity: tuning.current.combat.afterimageIntensity } } as never).unwrap();
      const ringInstance = copy(mat.ring);
      const ring = world.spawn(
        { component: Transform, data: { pos: [0, -50, 0], scale: [0, 0, 0] } },
        { component: MeshFilter, data: { assetHandle: mesh.ring } as never },
        { component: MeshRenderer, data: { materials: [ringInstance] } as never },
      ).unwrap();
      spawned.push(ring);
      let ringAge = -1;
      const sparkMesh = assets.create(sparkCloud()).unwrap();
      yield () => {
        assets.release(sparkMesh).unwrap();
      };
      const sparks = world.spawn(
        { component: Transform, data: { pos: [0, -50, 0] } },
        { component: MeshFilter, data: { assetHandle: sparkMesh } as never },
        { component: MeshRenderer, data: { materials: [mat.spark] } as never },
        { component: Points, data: { size: 0.11, sizeUnits: PointSizeUnitsValue.world, shape: PointShapeValue.soft } as never },
      ).unwrap();
      spawned.push(sparks);
      const sparkPos = new Float32Array(SPARKS * 3);
      const sparkVel = new Float32Array(SPARKS * 3);
      let sparkAge = -1;
      let sparkCount = SPARKS;
      let seed = 1;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      let slowLight = 0;
      let poseOut: { kind: string; frame: number; stage: number; charge: number; wheelsFull: boolean; airY: number; airVy: number; boost: number } = { kind: 'free', frame: 0, stage: 0, charge: 0, wheelsFull: false, airY: 0, airVy: 0, boost: 0 };
      let poseKey = 'free:0';
      let poseFrame = 0;
      let blendLeft = 0;
      let blendFrom: Shown | undefined;
      let shown: Shown = { rotation: [0, 0, 0, 1], spearQuat: spearQuat(SPEAR_REST), spearPos: SPEAR_REST.pos, offset: [0, 0, 0], pivotY: 0.6 };

      const env = () => {
        const root = player.root();
        const r: V2 = { x: root[0], z: root[2] };
        return {
          root: r,
          facing: player.facing(),
          strike: (at: V2, facing: number, range: number, arc: number) => target.strike(at.x, at.z, facing, range, arc),
          autoTarget: (at: V2, facing: number) => target.autoTarget(at.x, at.z, facing, tuning.current.combat.autoTurnRange),
          lockedFacing: () => (target.locked() ? target.facingFrom(r.x, r.z) : undefined),
          sashInRange: () => target.surfaceDistance(r.x, r.z) <= tuning.current.lock.acquireRange,
          touching: (at: V2) => target.touching(at.x, at.z) <= target.contactGap(),
        };
      };

      const onEvent = (event: CombatEvent) => {
        switch (event.type) {
          case 'hit': {
            hitSerial += 1;
            session.clock.hitstop(event.hitstop);
            if (event.shake > 0) session.shake(event.shake);
            session.emit(event.kind === 'heavy' ? 'hit-heavy' : 'hit');
            const segment = event.strike.segment ?? 0;
            target.damage(event.damage, segment);
            hitLog.push({ step: machine.snapshot().step, kind: event.kind, stage: event.stage, dmg: event.damage, dist: r3(event.strike.distance), ang: r3(event.strike.angleDeg), segment, tail: event.tail, hitstop: event.hitstop, shake: event.shake });
            while (hitLog.length > 24) hitLog.shift();
            // Sparks burst at the struck body point, chest height (real time, never paused).
            // Tail hits (boss 1B): 30 % of the sparks, 60 % of the size.
            const count = event.tail ? Math.round(SPARKS * 0.3) : SPARKS;
            world.set(sparks, Transform, { pos: [event.strike.point.x, FLOOR_Y + 1.1, event.strike.point.z] }).unwrap();
            world.set(sparks, Points, { size: event.tail ? 0.11 * 0.6 : 0.11 } as never).unwrap();
            for (let i = 0; i < SPARKS; i += 1) {
              if (i >= count) {
                // Unused sparks sit far below the seabed (never visible).
                sparkPos.set([0, -80, 0], i * 3);
                sparkVel.set([0, 0, 0], i * 3);
                continue;
              }
              sparkPos.set([0, 0, 0], i * 3);
              const a = rand() * Math.PI * 2, e = (rand() - 0.3) * 1.2, v = 5 + rand() * 7;
              sparkVel.set([Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v + 1, Math.sin(a) * Math.cos(e) * v], i * 3);
            }
            sparkCount = count;
            sparkAge = 0;
            break;
          }
          case 'swing-light':
            session.emit('swing-light');
            break;
          case 'swing-heavy':
            session.emit('swing-heavy');
            break;
          case 'charge-full':
            session.emit('charge-full');
            break;
          case 'roll':
            session.emit('roll');
            break;
          case 'jump':
            session.emit('jump');
            break;
          case 'land':
            session.emit(event.slam ? 'slam' : 'land');
            if (event.slam) session.shake(0.04);
            break;
          case 'sash-bind':
            bindSerial += 1;
            bindsSinceReset += 1;
            session.emit('sash-bind');
            break;
          case 'sash-ready':
            session.emit('sash-ready');
            break;
          case 'lotus-heal':
            session.emit('lotus');
            break;
          case 'hint':
            session.raiseHint(event.key);
            break;
          default:
            break;
        }
      };

      world.addSystem(FixedUpdate, {
        name: 'nezha-combat',
        after: ['nezha-clock'],
        before: ['nezha-player-movement'],
        queries: [],
        fn: () => {
          if (!session.playing()) {
            player.setControl(undefined);
            return;
          }
          if (tuning.revision() !== configRevision) {
            configRevision = tuning.revision();
            machine.setConfig(config());
          }
          const edges = player.takeEdges();
          const frame = player.input();
          const input = { ...edges, heavyHeld: frame.heavyHeld, sprint: frame.sprint, move: player.moveDirection() };
          if (session.clock.frozen()) {
            machine.hold(input);
            return;
          }
          const out = machine.step(input, env());
          state = out.state;
          for (const event of out.events) onEvent(event);
          player.setControl({ velocity: out.velocity, facing: out.facing, speedScale: out.speedScale, allowSprint: out.allowSprint });
          // Fire afterimages along the roll (boss 22:12: more of them, lingering ~1.1 s).
          const afterIndex = state.kind === 'roll' ? AFTER_FRAMES.indexOf(state.frame) : -1;
          if (afterIndex >= 0) {
            const m = readPresentationWorldMatrix(world, player.model);
            if (m) {
              bakeSlot(afterIndex, m);
              afterimages[afterIndex]!.life = tuning.current.combat.afterimageLife;
            }
          }
          if (cyanLeft > 0) {
            cyanLeft -= 1;
            if (cyanLeft === 0) assets.update(mat.afterimage, { values: { coreColor: [0.95, 0.22, 0.03, 1], rimColor: [1.0, 0.62, 0.12, 1], intensity: tuning.current.combat.afterimageIntensity } } as never).unwrap();
          }
          let anyLive = false;
          afterimages.forEach((slot, s) => {
            if (slot.life <= 0) return;
            slot.life -= 1;
            anyLive = true;
            // Boss 17:46: afterimages linger and fade out smoothly — bright most of their life, then fade.
            const left = slot.life / Math.max(1, tuning.current.combat.afterimageLife);
            fadeSlot(s, left > 0.5 ? 1 : (left / 0.5) ** 1.5);
          });
          if (anyLive || cloudLive) assets.writeRange(cloudMesh, { attribute: 'uv', first: 0, values: cloudUv }).unwrap();
          cloudLive = anyLive;
        },
      }).unwrap();
      yield () => world.removeSystem(FixedUpdate, 'nezha-combat').unwrap();

      // Presentation (every frame): pose, spear, flame, wheels, sparks, ring, slow-motion grade, HUD.
      world.addSystem(Update, {
        name: 'nezha-combat-pose',
        after: [FixedUpdate],
        before: ['nezha-player-pose', PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const dt = Math.min(world.getResource(Time).delta, 0.1);
          // Sub-step interpolation: poses advance smoothly between the 60 Hz combat steps.
          const fixed = world.getResource(FixedTime);
          const alpha = session.clock.frozen() || state.kind === 'free' ? 0 : Math.min(1, Math.max(0, fixed.overstep / Math.max(1e-6, fixed.delta)));
          const visual = actionVisual({ ...state, frame: state.frame + alpha }, player.facing());
          // Crossfade every action change (cancel, chain, roll-out): the pose never snaps.
          const key = `${state.kind}:${state.stage}`;
          if (key !== poseKey || state.frame + alpha < poseFrame - 0.5) {
            poseKey = key;
            blendFrom = shown;
            blendLeft = tuning.current.combat.poseBlend;
          }
          poseFrame = state.frame + alpha;
          const blendTotal = Math.max(1e-4, tuning.current.combat.poseBlend);
          if (!session.clock.frozen()) blendLeft = Math.max(0, blendLeft - dt);
          const w0 = blendFrom && blendLeft > 0 ? 1 - blendLeft / blendTotal : 1;
          const w = w0 * w0 * (3 - 2 * w0);
          const target: Shown = { rotation: visual.rotation, spearQuat: visual.spear.quat, spearPos: visual.spear.pos, offset: visual.offset, pivotY: visual.pivotY };
          shown = w >= 1 || !blendFrom ? target : mixShown(blendFrom, target, w);
          const active = state.kind !== 'free' || w < 1;
          player.setActionPose(active ? { rotation: shown.rotation, pivotY: shown.pivotY, offset: shown.offset, suppressLean: state.kind !== 'free' } : undefined);
          floatGate = visual.floatGate * floatScale;
          player.setFloatGate(floatGate);
          // Defeat (M4 §7): the wheel fire goes out over 30 steps. One live wheel material: the roll glow
          // and the defeat fade only change its emissive intensity (M4 §12: no material swaps).
          if (wheelFire === undefined) {
            wheelFire = copy(mat.wheel);
            // Rig wheel slots: gold, red, fire (first-use order of the wheel parts).
            for (const w of wheels) world.set(w, MeshRenderer, { materials: [mat.wheelGold, mat.wheelRed, wheelFire as never] } as never).unwrap();
          }
          if (state.kind === 'dead') deadFor = deadFor < 0 ? 0 : deadFor + dt * 60;
          else deadFor = -1;
          if (state.kind !== 'dead') wheelsFull = visual.wheelsFull;
          const glow = state.kind === 'dead' ? WHEEL_FIRE * Math.max(0, 1 - deadFor / 30) : wheelsFull ? WHEEL_FULL_INTENSITY : WHEEL_FIRE;
          if (Math.abs(glow - wheelGlow) > 1e-3) {
            wheelGlow = glow;
            assets.update(wheelFire as never, { values: { emissiveIntensity: glow } } as never).unwrap();
          }
          const snapAir = machine.snapshot();
          // Air height: interpolated toward the next step for smooth motion.
          const airY = Math.max(0, snapAir.airY + snapAir.airVy * alpha * STEP_S);
          player.setAirLift(airY);
          poseOut = { kind: state.kind, frame: state.frame + alpha, stage: state.stage, charge: state.charge, wheelsFull, airY, airVy: snapAir.airVy, boost: snapAir.boost };
          // Spear-tip flame: its end reaches the heavy range (3 m) ahead of the root.
          if (visual.flame) {
            // Measured on the presented spear (includes the body pitch and float): the flame runs from
            // the real tip along the shaft until it is 3 m (heavy range) ahead of the root.
            const sm = readPresentationWorldMatrix(world, spear);
            const root = player.root();
            const fwd = { x: -Math.sin(player.facing()), z: -Math.cos(player.facing()) };
            let length = 0.05;
            if (sm) {
              const ux = sm[4] ?? 0, uy = sm[5] ?? 0, uz = sm[6] ?? 0;
              const n = Math.hypot(ux, uy, uz) || 1;
              const tip = [(sm[12] ?? 0) + (ux / n) * SPEAR_ABOVE_GRIP, (sm[14] ?? 0) + (uz / n) * SPEAR_ABOVE_GRIP];
              const along = (tip[0]! - root[0]) * fwd.x + (tip[1]! - root[2]) * fwd.z;
              const horizontal = Math.max(0.2, ((ux / n) * fwd.x + (uz / n) * fwd.z));
              length = Math.max(0.05, (DEFAULT_COMBAT.heavyRange - along) / horizontal);
            }
            world.set(flame, Transform, { scale: [1.6, length, 1.6] }).unwrap();
            const fm = readPresentationWorldMatrix(world, flame);
            flameEnd = fm ? [r3((fm[12] ?? 0) + (fm[4] ?? 0)), r3((fm[13] ?? 0) + (fm[5] ?? 0)), r3((fm[14] ?? 0) + (fm[6] ?? 0))] : null;
          } else {
            // Keep the last flame end for QA (compared with the last heavy judgement line).
            world.set(flame, Transform, { scale: [0, 0, 0] }).unwrap();
          }
          // Sparks (real time).
          if (sparkAge >= 0) {
            sparkAge += dt;
            const life = tuning.current.combat.sparkLife;
            for (let i = 0; i < sparkCount; i += 1) {
              sparkVel[i * 3 + 1] = sparkVel[i * 3 + 1]! - 6 * dt;
              for (let a = 0; a < 3; a += 1) sparkPos[i * 3 + a] = sparkPos[i * 3 + a]! + sparkVel[i * 3 + a]! * dt;
            }
            if (sparkAge > life) {
              sparkAge = -1;
              world.set(sparks, Transform, { pos: [0, -50, 0] }).unwrap();
            } else assets.writeRange(sparkMesh, { attribute: 'position', first: 0, values: sparkPos }).unwrap();
          }
          // Perfect-dodge ring: radius 0 -> 1.2 m over 0.2 s at the root plane, once.
          if (ringAge >= 0) {
            ringAge += dt;
            const t = Math.min(1, ringAge / 0.2);
            const root = player.root();
            world.set(ring, Transform, { pos: [root[0], FLOOR_Y + 0.08, root[2]], scale: [1.2 * t, 1, 1.2 * t] }).unwrap();
            assets.update(ringInstance, { values: { intensity: 1.5 * (1 - t) } } as never).unwrap();
            if (t >= 1) {
              ringAge = -1;
              world.set(ring, Transform, { pos: [0, -50, 0], scale: [0, 0, 0] }).unwrap();
            }
          }
          // Slow-motion grade: world 30 % darker and cooler (lights + fog); emissive fire keeps its glow.
          const want = session.clock.snapshot().slowmo > 0 ? 1 : 0;
          slowLight += (want - slowLight) * (1 - Math.exp(-dt * 20));
          // Phase 2 (M4 §2): the scene light is ×0.8 (no warm tint), on top of the slow-motion grade.
          const dim = (1 - 0.3 * slowLight) * session.ambience().light;
          world.set(sun, DirectionalLight, { intensity: sunIntensity * dim, color: [sunColor[0]! * (1 - 0.15 * slowLight), sunColor[1]!, sunColor[2]! * (1 + 0.1 * slowLight)] }).unwrap();
          world.set(skylight, Skylight, { intensity: skyIntensity * dim }).unwrap();
          world.set(fog, Fog, { color: [WATER_HORIZON[0] * (1 - 0.3 * slowLight), WATER_HORIZON[1] * (1 - 0.15 * slowLight), WATER_HORIZON[2] * (1 + 0.15 * slowLight)] }).unwrap();

          const snap = machine.snapshot();
          const cd = snap.sashCd;
          session.contribute({
            combat: {
              hp: snap.hp,
              hpMax: DEFAULT_COMBAT.hpMax,
              stamina: snap.stamina,
              staminaMax: DEFAULT_COMBAT.staminaMax,
              flash: snap.flashSerial,
              lotus: snap.lotus,
              lotusMax: Math.round(tuning.current.difficulty.lotus),
              sashCd: Math.ceil(cd / 60),
              sashCdMax: DEFAULT_COMBAT.sash.cooldown / 60,
              hurt: hurtSerial,
              boost: snap.boost,
              perfect: perfectSerial,
              refund: DEFAULT_COMBAT.perfectRefund,
            },
          });
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-combat-pose').unwrap();
      yield () => {

        player.setActionPose(undefined);
        player.setControl(undefined);
      };

      const triggerPerfect = () => {
        session.clock.slowmo(tuning.current.combat.slowmoSteps);
        session.emit('perfect');
        ringAge = 0;
        perfectSerial += 1;
        // v1.4.0: the perfect-dodge trail turns pale cyan (and gets out of the way) for its lifetime.
        cyanLeft = tuning.current.combat.afterimageLife;
        assets.update(mat.afterimage, { values: { coreColor: [0.35, 0.85, 0.95, 1], rimColor: [0.75, 1.0, 1.0, 1], intensity: tuning.current.combat.afterimageIntensity * 0.6 } } as never).unwrap();
      };

      yield telemetry.section('combat', () => {
        const snap = machine.snapshot();
        const clock = session.clock.snapshot();
        const m = readPresentationWorldMatrix(world, player.entity);
        return {
          step: snap.step,
          action: snap.action,
          frame: snap.frame,
          stage: snap.stage,
          charge: snap.charge,
          combo: { stage: snap.comboStage, window: snap.comboWindow },
          buffered: snap.buffered,
          hp: snap.hp,
          stamina: r3(snap.stamina),
          lotus: snap.lotus,
          sashCd: snap.sashCd,
          invuln: snap.invuln,
          hudFlash: snap.flashSerial,
          hitstop: clock.hitstop,
          slowmo: clock.slowmo,
          tsWorld: clock.worldScale,
          tsNezha: clock.nezhaScale,
          floatGate,
          wheelsFull,
          judgeLine: snap.judgeLine ? [r3(snap.judgeLine.x), r3(snap.judgeLine.z)] : null,
          flameEnd: flameEnd ? [flameEnd[0], flameEnd[2]] : null,
          flameEndY: flameEnd ? flameEnd[1] : null,
          root: m ? [r3(m[12] ?? 0), r3((m[13] ?? 0) - CAPSULE_CENTER_Y), r3(m[14] ?? 0)] : null,
          airY: r3(snap.airY),
          airVy: r3(snap.airVy),
          boost: snap.boost,
          perfects: perfectSerial,
          hitLog,
          incoming: incomingLog,
          hurt: hurtSerial,
        };
      });

      yield ctx.provide('nezhaCombat', {
        incoming: (damage, knockback) => {
          const result = machine.incoming(damage, knockback);
          incomingLog.push({ step: machine.snapshot().step, result: result.type, ...(result.type === 'perfect' || result.type === 'dodged' ? { frame: result.frame } : {}), damage });
          while (incomingLog.length > 24) incomingLog.shift();
          if (result.type === 'perfect') triggerPerfect();
          if (result.type === 'hurt' || result.type === 'dead') {
            hurtSerial += 1;
            session.emit('hurt');
          }
          state = { ...state, kind: machine.snapshot().action, frame: machine.snapshot().frame };
          return result;
        },
        reset: () => {
          machine.setConfig(config());
          machine.reset();
          bindsSinceReset = 0;
          floatScale = 1;
          state = { kind: 'free', frame: 0, stage: 0, charge: 0, rollDir: { x: 0, z: 0 } };
          afterimages.forEach((slot, s) => {
            slot.life = 0;
            fadeSlot(s, 0);
          });
          assets.writeRange(cloudMesh, { attribute: 'uv', first: 0, values: cloudUv }).unwrap();
          player.setControl(undefined);
        },
        hp: () => machine.snapshot().hp,
        action: () => machine.snapshot().action,
        pose: () => poseOut,
        airHeight: () => machine.snapshot().airY,
        setPresentation: (p) => {
          floatScale = p.floatScale ?? 1;
        },
        usage: () => ({ lotusLeft: machine.snapshot().lotus, lotusMax: Math.round(tuning.current.difficulty.lotus), binds: bindsSinceReset }),
        hitSerial: () => hitSerial,
        bindSerial: () => bindSerial,
        sashCooldown: () => ({ left: machine.snapshot().sashCd, total: DEFAULT_COMBAT.sash.cooldown }),
        bindHoldSteps: () => DEFAULT_COMBAT.sash.holdSteps,
      } satisfies CombatService);
    }, 'nezha/combat');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.combatPlugin,
  build: () => ok({
    'plugin/combat': { kind: 'plugin', module: { specifier: './combat.pack.ts', export: 'combat' } },
  }),
});
