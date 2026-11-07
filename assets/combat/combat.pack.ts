import { JOINT_PARTS, jointKey, kebab } from '../nezha-rig/rig-def.ts';
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
import { SEA_FOG } from '../environment.pack.ts';
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

function sparkCloud(SPARKS = 16): MeshAsset {
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
      qi: await load(guidText(materialGuid('qi-spark')), 'material'),
      afterimage: await load(guidText(materialGuid('afterimage-cloud')), 'material'),
      ring: await load(guidText(materialGuid('perfect-ring')), 'material'),
      spark: await load(guidText(materialGuid('spark')), 'material'),
      flame: await load(guidText(materialGuid('flame')), 'material'),
    };
    const mesh = {
      body: await load(guidText(characterGuid('nezha-body')), 'mesh'),
      // Afterimages show the jointed Nezha (boss 11-06 20:57): every jointed part plus the spear.
      parts: await Promise.all([...Object.keys(JOINT_PARTS).map((j) => load(guidText(characterGuid(`nz-${kebab(j)}`)), 'mesh')), load(guidText(characterGuid('nz-spear')), 'mesh')]),
      ring: await load(guidText(geometryGuid('ring')), 'mesh'),
      flame: await load(guidText(geometryGuid('flame')), 'mesh'),
    };

    await ctx.effect(function* () {
      yield () => {
        for (const handle of [...Object.values(mat), ...Object.values(mesh).flat()] as never[]) assets.release(handle).unwrap();
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
      // Afterimage pool (boss 11-06 20:57): the roll leaves five dark ones as before; plain movement
      // leaves pale ones every 5 steps. All live in ONE mesh (one draw); uv0.x = fade, uv0.y = strength.
      const SLOTS = 12;
      const partEntities = [...Object.keys(JOINT_PARTS).map((j) => resolveGameEntity(world, scene, jointKey(j as never))), spear];
      const partData = (mesh.parts as unknown as never[]).map((h) => assets.read(h).unwrap() as MeshAsset);
      const partBase: number[] = [];
      let bodyVerts = 0;
      const bodyIdx: number[] = [];
      for (const m of partData) {
        partBase.push(bodyVerts);
        const idx = m.indices as Uint32Array | Uint16Array | undefined;
        for (const sm of m.submeshes) for (let q = 0; q < sm.indexCount; q += 1) bodyIdx.push((idx?.[sm.indexOffset + q] ?? 0) + ((sm as { baseVertex?: number }).baseVertex ?? 0) + bodyVerts);
        bodyVerts += (m.attributes.position as Float32Array).length / 3;
      }
      const cloudIdx = new Uint32Array(bodyIdx.length * SLOTS);
      for (let sl = 0; sl < SLOTS; sl += 1) bodyIdx.forEach((v, q) => (cloudIdx[sl * bodyIdx.length + q] = v + sl * bodyVerts));
      const cloudPos = new Float32Array(bodyVerts * 3 * SLOTS);
      for (let v = 0; v < cloudPos.length; v += 3) cloudPos[v + 1] = -50;
      const cloudNor = new Float32Array(cloudPos.length);
      const cloudUv = new Float32Array(bodyVerts * 2 * SLOTS);
      const cloudBuilt = createMeshBuilder({
        attributes: { position: cloudPos, normal: cloudNor, uv: cloudUv },
        indices: cloudIdx,
        submeshes: [{ indexOffset: 0, indexCount: cloudIdx.length, vertexCount: bodyVerts * SLOTS, topology: 'triangle-list', materialSlot: 0 }],
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
      const afterimages = Array.from({ length: SLOTS }, () => ({ life: 0, total: 1, age: 0 }));
      let walkGap = 0;
      let cloudLive = false;
      let perfectSerial = 0;
      let cyanLeft = 0;
      /** Bake every part of the jointed Nezha at its current world matrix into slot s (world space). */
      const bakeSlot = (s: number) => {
        const o = s * bodyVerts * 3;
        partData.forEach((m, pi) => {
          const mm = readPresentationWorldMatrix(world, partEntities[pi]!);
          if (!mm) return;
          const pos = m.attributes.position as Float32Array, nor = m.attributes.normal as Float32Array;
          const base = o + partBase[pi]! * 3;
          for (let v = 0; v < pos.length / 3; v += 1) {
            const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
            cloudPos[base + v * 3] = mm[0]! * x + mm[4]! * y + mm[8]! * z + mm[12]!;
            cloudPos[base + v * 3 + 1] = mm[1]! * x + mm[5]! * y + mm[9]! * z + mm[13]!;
            cloudPos[base + v * 3 + 2] = mm[2]! * x + mm[6]! * y + mm[10]! * z + mm[14]!;
            const nx = nor[v * 3]!, ny = nor[v * 3 + 1]!, nz = nor[v * 3 + 2]!;
            cloudNor[base + v * 3] = mm[0]! * nx + mm[4]! * ny + mm[8]! * nz;
            cloudNor[base + v * 3 + 1] = mm[1]! * nx + mm[5]! * ny + mm[9]! * nz;
            cloudNor[base + v * 3 + 2] = mm[2]! * nx + mm[6]! * ny + mm[10]! * nz;
          }
        });
        assets.writeRange(cloudMesh, { attribute: 'position', first: s * bodyVerts, values: cloudPos.subarray(o, o + bodyVerts * 3) }).unwrap();
        assets.writeRange(cloudMesh, { attribute: 'normal', first: s * bodyVerts, values: cloudNor.subarray(o, o + bodyVerts * 3) }).unwrap();
      };
      /** Take the free slot (or the oldest) and start an afterimage there. */
      const spawnGhost = (life: number, strength: number) => {
        let best = 0;
        for (let q = 1; q < SLOTS; q += 1) if (afterimages[q]!.life < afterimages[best]!.life) best = q;
        bakeSlot(best);
        afterimages[best] = { life, total: life, age: 0 };
        const o = best * bodyVerts * 2;
        for (let v = 0; v < bodyVerts; v += 1) cloudUv[o + v * 2 + 1] = strength;
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
      // 灵息 (v1.4.0 staminaReward): cyan qi gathers from a ring round Nezha into her chest over 0.6 s.
      const QI = 40;
      const qiMesh = assets.create(sparkCloud(QI)).unwrap();
      yield () => assets.release(qiMesh).unwrap();
      const qi = world.spawn(
        { component: Transform, data: { pos: [0, 0, 0] } },
        { component: MeshFilter, data: { assetHandle: qiMesh } as never },
        { component: MeshRenderer, data: { materials: [mat.qi] } as never },
        { component: Points, data: { size: 0.09, sizeUnits: PointSizeUnitsValue.world, shape: PointShapeValue.soft } as never },
      ).unwrap();
      spawned.push(qi);
      const qiPos = new Float32Array(QI * 3);
      const qiFrom = new Float32Array(QI * 3);
      let qiAge = -1;
      for (let i = 0; i < QI; i += 1) qiPos[i * 3 + 1] = -50;
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
            world.set(sparks, Transform, { pos: [event.strike.point.x, FLOOR_Y + 1.1 + player.altitude(), event.strike.point.z] }).unwrap();
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
          // Afterimages: dark along the roll (frames 1, 4, 7, 10, 13; ~1.1 s), pale while moving (every 5 steps, 0.4 s).
          // Afterimages moved to the rig plugin (they show the asset-track model).
          if (false as boolean) spawnGhost(tuning.current.combat.afterimageLife, 1);
          else if (false as boolean) {
            walkGap -= 1;
            if (walkGap <= 0) {
              walkGap = 6;
              spawnGhost(20, player.mode() === 'sprint' ? 0.2 : 0.13);
            }
          } else walkGap = 0;
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
            const left = slot.life / Math.max(1, slot.total);
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
            for (const w of wheels) if (world.get(w, MeshRenderer).ok) world.set(w, MeshRenderer, { materials: [mat.wheelGold, mat.wheelRed, wheelFire as never] } as never).unwrap();
          }
          if (state.kind === 'dead') deadFor = deadFor < 0 ? 0 : deadFor + dt * 60;
          else deadFor = -1;
          if (state.kind !== 'dead') wheelsFull = visual.wheelsFull;
          const glow = state.kind === 'dead' ? WHEEL_FIRE * Math.max(0, 1 - deadFor / 30) : wheelsFull ? WHEEL_FULL_INTENSITY : WHEEL_FIRE;
          // v1.4.0: the rim flames flicker every frame (0.7–1.3 ×).
          const flickered = glow * (state.kind === 'dead' ? 1 : 0.8 + Math.random() * 0.4);
          if (Math.abs(flickered - wheelGlow) > 1e-3) {
            wheelGlow = flickered;
            assets.update(wheelFire as never, { values: { emissiveIntensity: flickered } } as never).unwrap();
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
          if (qiAge >= 0) {
            qiAge += dt;
            const rt = player.root();
            const chest = [rt[0], rt[1] + 1.3 + player.altitude(), rt[2]];
            if (qiAge > 0.7) {
              qiAge = -1;
              for (let i = 0; i < QI; i += 1) qiPos[i * 3 + 1] = -50;
            } else {
              for (let i = 0; i < QI; i += 1) {
                const u = Math.min(1, Math.max(0, (qiAge - (i % 5) * 0.02) / 0.55));
                const e = u * u * (3 - 2 * u);
                const sw = Math.sin(u * Math.PI) * 0.35;
                const fx = qiFrom[i * 3]!, fy = qiFrom[i * 3 + 1]!, fz = qiFrom[i * 3 + 2]!;
                // Spiral in: a sideways swirl that vanishes at the chest.
                const dx = fx - chest[0]!, dz = fz - chest[2]!;
                qiPos.set([chest[0]! + dx * (1 - e) - dz * sw * (1 - e), fy + (chest[1]! - fy) * e, chest[2]! + dz * (1 - e) + dx * sw * (1 - e)], i * 3);
                if (u >= 1) qiPos[i * 3 + 1] = -50;
              }
            }
            assets.writeRange(qiMesh, { attribute: 'position', first: 0, values: qiPos }).unwrap();
          }
          if (ringAge >= 0) {
            ringAge += dt;
            const t = Math.min(1, ringAge / 0.2);
            const root = player.root();
            world.set(ring, Transform, { pos: [root[0], FLOOR_Y + 0.08 + player.altitude() + tuning.current.move.hoverHeight * 0.6, root[2]], scale: [1.2 * t, 1, 1.2 * t] }).unwrap();
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
          world.set(fog, Fog, { color: [SEA_FOG[0] * (1 - 0.3 * slowLight) * dim, SEA_FOG[1] * (1 - 0.15 * slowLight) * dim, SEA_FOG[2] * (1 + 0.15 * slowLight) * dim] }).unwrap();

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
        // v1.4.0 perfectDodge: the world drops to 0.22 for 0.55 s.
        session.clock.slowmo(33, 0.22);
        session.emit('perfect');
        ringAge = 0;
        perfectSerial += 1;
        qiAge = 0;
        {
          const rt = player.root();
          for (let i = 0; i < QI; i += 1) {
            const a = rand() * Math.PI * 2, rr = 1.6 + rand() * 0.9;
            qiFrom.set([rt[0] + Math.sin(a) * rr, rt[1] + 0.3 + rand() * 1.7 + player.altitude(), rt[2] + Math.cos(a) * rr], i * 3);
          }
        }
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
