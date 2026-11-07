import { definePack } from '@forgeax/engine/pack/source';
import { Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createMeshBuilder } from '@forgeax/engine/geometry';
import { MeshFilter, MeshRenderer, PointLight } from '@forgeax/engine/render';
import type {} from '@forgeax/engine/assets-runtime';
import { Ribbon, ribbonSpec, stripIndices, type V3 as RV3 } from './ribbons.ts';
import { geometryGuid, guidText, materialGuid } from '../shared/asset-refs.ts';
import { FLOOR_Y } from '../shared/layout.ts';
import type { Plugin } from '@forgeax/engine/plugin';
import { ChildOf, PROPAGATE_TRANSFORMS_SYSTEM, readPresentationWorldMatrix, Transform } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type { CombatService } from '../combat/combat.pack.ts';
import { DEFAULT_COMBAT } from '../combat/machine.ts';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { resolveGameEntity } from '../shared/scene-refs.ts';
import { buildModel, GhostCloud, type MountedModel } from '../shared/model-rig.ts';
import { MODEL_GUIDS, NEZHA_IBM, NEZHA_JOINTS, NEZHA_NODES, SKELETON_GUIDS } from '../models/skins.ts';
import {
  blendPose,
  glidePose,
  HEAVY_KF,
  HC,
  HoverMotion,
  JOINT_NAMES,
  JOINTS,
  JUMP_DOWN,
  JUMP_UP,
  jointKey,
  L3b,
  keyframes,
  LIGHT_KF,
  LIGHT4_KF,
  spinOf,
  P_CAST,
  P_DEAD,
  P_DRINK,
  P_HURT,
  P_IDLE,
  PINS,
  poseJoints,
  RIG_SCALE,
  qEuler,
  ROLL_TUCK,
  zeroPose,
  type HoverOut,
  type HoverState,
  type JointName,
  type Pose,
  type V3,
} from './rig-def.ts';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** World position of a local point under an entity (this frame's presented matrix). */
let worldPoint: (entity: EntityHandle, local: V3) => [number, number, number];
const HEAVY_STEPS = 9 + DEFAULT_COMBAT.heavyRecover;

export interface RigService {
  /** The inertia layer this frame (height offset, lean, bank) — float-fx adds it to the bob. */
  readonly hover: () => HoverOut;
  /** World matrix of a joint (ribbon pins, effects). */
  readonly joint: (name: JointName) => EntityHandle;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    nezhaRig: RigService;
  }
}

/**
 * Jointed Nezha at run time (v1.4.0 port, boss 11-06 batch 2): picks the pose for the combat
 * state (v1.4.0 keyframes on our timings), blends it in, layers the HoverMotion inertia on top
 * (pelvis lag, head look-ahead, swinging legs, lean and bank), spins the upright wheels.
 */
export const nezhaRig: Plugin = {
  name: 'nezha/rig',
  provide: 'nezhaRig',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer', 'nezhaCombat'],
  async apply(ctx) {
    const world = ctx.world;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    const player = ctx.nezhaPlayer as PlayerService | undefined;
    const combat = ctx.nezhaCombat as CombatService | undefined;
    if (!session || !tuning || !telemetry || !player || !combat) throw new Error('nezha/rig requires core, player and combat');
    const host = ctx.gameHost;
    if (!host) throw new Error('nezha/rig requires the GameHost');
    const assets = host.assets;
    const silkLoaded = await assets.load(guidText(materialGuid('nz-silk')), 'material');
    if (!silkLoaded.ok) throw silkLoaded.error;
    const silk = silkLoaded.value;
    const sashLoaded = await assets.load(guidText(materialGuid('sash-live')), 'material');
    if (!sashLoaded.ok) throw sashLoaded.error;
    const sashMat = sashLoaded.value;
    const haloLoaded = await assets.load(guidText(materialGuid('wheel-halo')), 'material');
    if (!haloLoaded.ok) throw haloLoaded.error;
    const haloMesh = await assets.load(guidText(geometryGuid('wheel-halo')), 'mesh');
    if (!haloMesh.ok) throw haloMesh.error;
    const trailLoaded = await assets.load(guidText(materialGuid('weapon-trail')), 'material');
    if (!trailLoaded.ok) throw trailLoaded.error;
    const rigRoot = resolveGameEntity(world, ctx.gameScene, 'player/rig');
    const spearEntity = resolveGameEntity(world, ctx.gameScene, 'player/spear');
    worldPoint = (entity, local) => {
      const m = readPresentationWorldMatrix(world, entity);
      if (!m) return [0, -50, 0];
      return [
        m[0]! * local[0] + m[4]! * local[1] + m[8]! * local[2] + m[12]!,
        m[1]! * local[0] + m[5]! * local[1] + m[9]! * local[2] + m[13]!,
        m[2]! * local[0] + m[6]! * local[1] + m[10]! * local[2] + m[14]!,
      ];
    };
    const joints = Object.fromEntries(JOINT_NAMES.map((n) => [n, resolveGameEntity(world, ctx.gameScene, jointKey(n))])) as Record<JointName, EntityHandle>;

    // --- Asset-track Nezha (11-06 22:24): the skinned glb replaces the code-built jointed parts. Its
    // skeleton has our joint names (positions = JOINTS × 0.86 m); under player/rig (×0.86) it is scaled
    // back by 1 / 0.86, and every frame its bones take the same rotations as our joints.
    const mat = async (key: string) => {
      const h = await assets.load(guidText(materialGuid(key)), 'material');
      if (!h.ok) throw h.error;
      return h.value;
    };
    const mm = { body: await mat('model-nezha'), skin: await mat('model-nezha-skin') };
    const mounted = await buildModel(world, assets, {
      nodes: NEZHA_NODES,
      skinMesh: 'Nezha',
      skinJoints: NEZHA_JOINTS,
      skeletonGuid: SKELETON_GUIDS.nezha,
      meshGuids: { Nezha: MODEL_GUIDS.nezha.Nezha, WindFireWheel_L: MODEL_GUIDS.nezha.WindFireWheel_L, WindFireWheel_R: MODEL_GUIDS.nezha.WindFireWheel_R, FireTippedSpear: MODEL_GUIDS.nezha.FireTippedSpear },
      // One vertex-colour material per mesh (glow parts coded in the vertex alpha); repeated per submesh.
      materials: { Nezha: [mm.skin], WindFireWheel_L: [mm.body], WindFireWheel_R: [mm.body], FireTippedSpear: [mm.body] },
      parent: rigRoot,
      local: { scale: [1 / RIG_SCALE, 1 / RIG_SCALE, 1 / RIG_SCALE] },
    });
    const model: MountedModel = mounted.model;
    const ghostMat = await assets.load(guidText(materialGuid('afterimage-cloud')), 'material');
    if (!ghostMat.ok) throw ghostMat.error;
    const hiddenOld = [...JOINT_NAMES.filter((n) => world.get(joints[n], MeshRenderer).ok).map((n) => joints[n]), spearEntity];

    await ctx.effect(function* () {
      yield () => assets.release(silk).unwrap();
      yield mounted.dispose;
      yield () => { assets.release(ghostMat.value).unwrap(); for (const h of Object.values(mm)) assets.release(h).unwrap(); };
      for (const e of hiddenOld) if (world.get(e, MeshRenderer).ok) world.removeComponent(e, MeshRenderer).unwrap();
      const bone = (name: string) => (model.has(name) ? model.bone(name) : undefined);
      const modelJoint = Object.fromEntries(JOINT_NAMES.map((n) => [n, bone(n)])) as Record<JointName, EntityHandle | undefined>;
      // Afterimages of the real model (CPU-skinned body + wheels + spear), one draw (boss 20:57: pale
      // while moving, dark along the roll).
      const ghosts = new GhostCloud(world, assets as never, [
        { kind: 'skinned', mesh: model.meshData.get('Nezha')!, joints: NEZHA_JOINTS.map((n) => model.bone(n)), ibm: NEZHA_IBM },
        ...(['WindFireWheel_L', 'WindFireWheel_R', 'FireTippedSpear'] as const).map((n) => ({ kind: 'rigid' as const, mesh: model.meshData.get(n)!, entity: model.bone(n) })),
      ], 10, ghostMat.value);
      yield () => world.despawn(ghosts.entity).unwrap();
      let ghostGap = 0, lastRollFrame = -1;
      yield () => { assets.release(sashMat).unwrap(); assets.release(haloLoaded.value).unwrap(); assets.release(haloMesh.value).unwrap(); };
      // --- 混天绫 (v1.4.0): both ends tied behind the shoulders, floating up and back into a loop. It wears
      // the live sash material (cooldown dimming / gold fill / ready glint), uv.y root → middle → root.
      const S0 = RIG_SCALE;
      const loop = new Ribbon(ribbonSpec({ n: 32, len: 2.8 * S0, width: 0.17 * S0, gravity: 0.35, flutter: 6, taper: 0.3, twist: 0.9, back: 5.5 }, 0.7));
      const loopPos = new Float32Array(32 * 2 * 3);
      const loopNor = new Float32Array(32 * 2 * 3);
      for (let v = 0; v < 64; v += 1) loopNor[v * 3 + 1] = 1;
      const loopUv = new Float32Array(32 * 2 * 2);
      for (let i = 0; i < 32; i += 1) { const y = 1 - Math.abs(i / 31 - 0.5) * 2; loopUv.set([0, y, 1, y], i * 4); }
      const loopIdx = stripIndices([32]);
      const loopBuilt = createMeshBuilder({
        attributes: { position: loopPos, normal: loopNor, uv: loopUv },
        indices: loopIdx,
        submeshes: [{ indexOffset: 0, indexCount: loopIdx.length, vertexCount: 64, topology: 'triangle-list', materialSlot: 0 }],
        materialSlots: [{ slotName: 'sash' }],
      }).build();
      if (!loopBuilt.ok) throw loopBuilt.error;
      const loopMesh = assets.create({ ...loopBuilt.value, aabb: new Float32Array([-80, -10, -80, 80, 30, 80]) }).unwrap();
      yield () => assets.release(loopMesh).unwrap();
      const loopEntity = world.spawn(
        { component: Transform, data: { pos: [0, 0, 0] } },
        { component: MeshFilter, data: { assetHandle: loopMesh } as never },
        { component: MeshRenderer, data: { materials: [sashMat] } as never },
      ).unwrap();
      yield () => world.despawn(loopEntity).unwrap();
      world.set(loopEntity, Transform, { scale: [0, 0, 0] }).unwrap();
      const restOf = (e: EntityHandle) => { const q = world.get(e, Transform).unwrap().quat; return [q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 1] as [number, number, number, number]; };
      const sashBones = { L: [] as { e: EntityHandle; rest: [number, number, number, number] }[], R: [] as { e: EntityHandle; rest: [number, number, number, number] }[] };
      for (const side of ['L', 'R'] as const) for (let k = 1; k <= 12; k += 1) { const e = bone(`sash_${side}_${String(k).padStart(2, '0')}`); if (e !== undefined) sashBones[side].push({ e, rest: restOf(e) }); }
      const tasselBones = [1, 2, 3, 4].map((k) => bone(`tassel_0${k}`)).filter((e): e is EntityHandle => e !== undefined).map((e) => ({ e, rest: restOf(e) }));
      const qMulArr = (a: readonly number[], b: readonly number[]): [number, number, number, number] => [
        a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
        a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
        a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
        a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
      ];
      // --- 风火轮 fire (v1.4.0 wheels): a flame halo round each rim (flickering) and a warm light.
      const haloMat = assets.copy(haloLoaded.value).unwrap();
      yield () => assets.release(haloMat).unwrap();
      const wheelFx = (['lMount', 'rMount'] as const).map((mount) => {
        const halo = world.spawn(
          { component: Transform, data: { pos: [0, 0, 0] } },
          { component: ChildOf, data: { parent: joints[mount] } },
          { component: MeshFilter, data: { assetHandle: haloMesh.value } as never },
          { component: MeshRenderer, data: { materials: [haloMat] } as never },
        ).unwrap();
        const light = world.spawn(
          { component: Transform, data: { pos: [0, 0, 0.05] } },
          { component: ChildOf, data: { parent: joints[mount] } },
          { component: PointLight, data: { color: [1.0, 0.45, 0.12], intensity: 4, range: 3.2, decay: 2 } as never },
        ).unwrap();
        return { halo, light };
      });
      yield () => { for (const w of wheelFx) { world.despawn(w.light).unwrap(); world.despawn(w.halo).unwrap(); } };
      let flick = 1;
      // --- Spear swing trail (v1.4.0 Trail: 16 samples of blade + shaft, 0.15 s life, additive). ---
      const TN = 16, TLIFE = 0.15;
      const trailMat = assets.copy(trailLoaded.value).unwrap();
      yield () => { assets.release(trailMat).unwrap(); assets.release(trailLoaded.value).unwrap(); };
      const trailPos = new Float32Array(TN * 2 * 3);
      const trailUv = new Float32Array(TN * 2 * 2);
      const trailNor = new Float32Array(TN * 2 * 3);
      for (let v = 0; v < TN * 2; v += 1) trailNor[v * 3 + 1] = 1;
      const trailIdx = stripIndices([TN]);
      const trailBuilt = createMeshBuilder({
        attributes: { position: trailPos, normal: trailNor, uv: trailUv },
        indices: trailIdx,
        submeshes: [{ indexOffset: 0, indexCount: trailIdx.length, vertexCount: TN * 2, topology: 'triangle-list', materialSlot: 0 }],
        materialSlots: [{ slotName: 'trail' }],
      }).build();
      if (!trailBuilt.ok) throw trailBuilt.error;
      const trailMesh = assets.create({ ...trailBuilt.value, aabb: new Float32Array([-80, -10, -80, 80, 30, 80]) }).unwrap();
      yield () => assets.release(trailMesh).unwrap();
      const trailEntity = world.spawn(
        { component: Transform, data: { pos: [0, 0, 0] } },
        { component: MeshFilter, data: { assetHandle: trailMesh } as never },
        { component: MeshRenderer, data: { materials: [trailMat] } as never },
      ).unwrap();
      yield () => world.despawn(trailEntity).unwrap();
      const samples: { a: RV3; b: RV3; age: number }[] = [];
      let trailOn = false, trailWasLive = false, spinNow = 0;
      /** When the blade leaves a trail (v1.4.0: from the swing start through the hit window). */
      const trailActive = () => {
        const c = combat.pose();
        if (c.kind === 'light') {
          const spec = DEFAULT_COMBAT.light[Math.max(0, Math.min(3, c.stage - 1))]!;
          return c.stage === 4 ? c.frame >= 6 && c.frame <= 34 : c.frame >= 2 && c.frame <= spec.hit + 4;
        }
        if (c.kind === 'heavy') return c.frame <= 14;
        if (c.kind === 'airatk') return c.frame >= 10;
        return false;
      };
      // --- Extra ribbons (v1.4.0): arm sash, waist sash, hair ribbons, spear tassel — one mesh, one draw.
      const S = RIG_SCALE;
      const ribbonDefs: { pin: () => RV3; spec: ReturnType<typeof ribbonSpec> }[] = [];
      const atJoint = (name: JointName, local: V3) => () => worldPoint(joints[name], local);
      ribbonDefs.push({ pin: atJoint(PINS.armL.joint, PINS.armL.pos), spec: ribbonSpec({ n: 22, len: 2.0 * S, width: 0.11 * S, gravity: -0.8, flutter: 6, taper: 0.6, twist: 1.1, back: 4 }, 1.3) });
      ribbonDefs.push({ pin: atJoint(PINS.waist.joint, PINS.waist.pos), spec: ribbonSpec({ n: 20, len: 1.7 * S, width: 0.1 * S, gravity: -1.2, flutter: 6, taper: 0.6, twist: 1.1, back: 4 }, 2.7) });
      ribbonDefs.push({ pin: atJoint(PINS.bunL.joint, PINS.bunL.pos), spec: ribbonSpec({ n: 9, len: 0.6 * S, width: 0.045 * S, gravity: -1.5, flutter: 5, taper: 0.4, back: 2.5 }, 4.1) });
      ribbonDefs.push({ pin: atJoint(PINS.bunR.joint, PINS.bunR.pos), spec: ribbonSpec({ n: 9, len: 0.6 * S, width: 0.045 * S, gravity: -1.5, flutter: 5, taper: 0.4, back: 2.5 }, 5.9) });
      for (let k = 0; k < 0; k += 1) { // the model carries its own tassel now
        const a = (k / 6) * Math.PI * 2;
        const local: V3 = [Math.cos(a) * 0.02, PINS.tassel.pos[1], Math.sin(a) * 0.02];
        ribbonDefs.push({ pin: () => worldPoint(spearEntity, local), spec: ribbonSpec({ n: 7, len: 0.34 + k * 0.03, width: 0.04, gravity: -3.5, flutter: 4, taper: 0.6, twist: 0.5, back: 1.2 }, 7 + k) });
      }
      const ribbons = ribbonDefs.map((d) => new Ribbon(d.spec));
      const counts = ribbonDefs.map((d) => d.spec.n);
      const vertexCount = counts.reduce((a, n) => a + n * 2, 0);
      const ribbonPos = new Float32Array(vertexCount * 3);
      const ribbonNor = new Float32Array(vertexCount * 3);
      for (let v = 0; v < vertexCount; v += 1) ribbonNor[v * 3 + 1] = 1;
      const indices = stripIndices(counts);
      const built = createMeshBuilder({
        attributes: { position: ribbonPos, normal: ribbonNor, uv: new Float32Array(vertexCount * 2) },
        indices,
        submeshes: [{ indexOffset: 0, indexCount: indices.length, vertexCount, topology: 'triangle-list', materialSlot: 0 }],
        materialSlots: [{ slotName: 'silk' }],
      }).build();
      if (!built.ok) throw built.error;
      const ribbonMesh = assets.create({ ...built.value, aabb: new Float32Array([-80, -10, -80, 80, 30, 80]) }).unwrap();
      yield () => assets.release(ribbonMesh).unwrap();
      const ribbonEntity = world.spawn(
        { component: Transform, data: { pos: [0, 0, 0] } },
        { component: MeshFilter, data: { assetHandle: ribbonMesh } as never },
        { component: MeshRenderer, data: { materials: [silk] } as never },
      ).unwrap();
      yield () => world.despawn(ribbonEntity).unwrap();
      let ribbonTime = 0;

      const pose: Pose = { ...zeroPose(), ...P_IDLE };
      const hover = new HoverMotion();
      let state: HoverState = 'idle';
      let prevRoot: V3 | undefined;
      let vel = { x: 0, z: 0 };
      let spin = 0;
      let wheelScale = 1;
      let time = 0;

      const target = (): { pose: Pose; rate: number; hs: HoverState } => {
        const c = combat.pose();
        const speed = player.speed();
        if (c.kind === 'airatk') {
          // Plunging attack (v1.4.0 跳劈): spear raised in the hang, driven down as she drops.
          return { pose: keyframes(P_IDLE, [[0, HC], [0.45, HC], [0.7, L3b], [1, L3b]], Math.min(1, c.frame / 24)), rate: 24, hs: 'airatk' };
        }
        if (c.airY > 0.02 && (c.kind === 'free' || c.kind === 'roll')) {
          if (c.kind === 'free') return { pose: c.airVy > 0 ? JUMP_UP : JUMP_DOWN, rate: 14, hs: 'jump' };
        }
        switch (c.kind) {
          case 'light': {
            const stage = Math.max(1, Math.min(4, c.stage));
            const spec = DEFAULT_COMBAT.light[stage - 1]!;
            // v1.4.0 rate 30: the swing snaps through instead of lagging behind the keyframes.
            return { pose: keyframes(P_IDLE, stage === 4 ? LIGHT4_KF : LIGHT_KF[stage - 1]!, Math.min(1, c.frame / (spec.hit + spec.recover))), rate: 30, hs: 'attack' };
          }
          case 'charge':
            return { pose: { ...P_IDLE, ...HC, tX: (HC.tX ?? 0) + Math.sin(time * 40) * 0.01 * Math.min(1, c.charge / DEFAULT_COMBAT.chargeMax) * 3 }, rate: 16, hs: 'charge' };
          case 'heavy':
            return { pose: keyframes(P_IDLE, HEAVY_KF, Math.min(1, c.frame / HEAVY_STEPS)), rate: 30, hs: 'heavy' };
          case 'roll':
            return { pose: c.frame < DEFAULT_COMBAT.roll.steps - 6 ? ROLL_TUCK : P_IDLE, rate: 24, hs: 'roll' };
          case 'hurt':
            return { pose: P_HURT, rate: 20, hs: 'hurt' };
          case 'lotus':
            return { pose: P_DRINK, rate: 16, hs: 'drink' };
          case 'sash':
            return { pose: P_CAST, rate: 16, hs: 'cast' };
          case 'dead':
            return { pose: P_DEAD, rate: 8, hs: 'dead' };
          default: {
            const mode = player.mode();
            if (speed > 0.4) return { pose: glidePose(speed), rate: 16, hs: mode === 'sprint' ? 'sprint' : 'move' };
            return { pose: { ...P_IDLE, tX: P_IDLE.tX + Math.sin(time * 2) * 0.02 }, rate: 16, hs: 'idle' };
          }
        }
      };

      const setRot = (name: JointName, e: V3) => {
        const q = qEuler(e[0], e[1], e[2]);
        world.set(joints[name], Transform, { quat: [q[0], q[1], q[2], q[3]] }).unwrap();
        const m = modelJoint[name];
        if (m !== undefined) world.set(m, Transform, { quat: [q[0], q[1], q[2], q[3]] }).unwrap();
      };

      world.addSystem(Update, {
        name: 'nezha-rig',
        after: ['nezha-combat-pose'],
        before: ['nezha-float-fx', 'nezha-player-pose', PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const raw = Math.min(world.getResource(Time).delta, 0.1);
          const dt = raw * session.clock.nezhaScale();
          if (session.phase() === 'paused') return;
          time += dt;
          // Velocity from the presented root (real motion, any source).
          const m = readPresentationWorldMatrix(world, player.entity);
          const root: V3 = m ? [m[12] ?? 0, m[13] ?? 0, m[14] ?? 0] : player.root();
          if (prevRoot && raw > 0) {
            const nx = (root[0] - prevRoot[0]) / raw, nz = (root[2] - prevRoot[2]) / raw;
            const k = 1 - Math.exp(-raw * 20);
            vel = { x: vel.x + (nx - vel.x) * k, z: vel.z + (nz - vel.z) * k };
          }
          prevRoot = root;
          const tgt = target();
          state = tgt.hs;
          if (dt > 0) blendPose(pose, tgt.pose, 1 - Math.exp(-dt * tgt.rate));
          const dir = player.moveDirection();
          const inputYaw = Math.hypot(dir.x, dir.z) > 0.1 ? Math.atan2(-dir.x, -dir.z) : null;
          const h = hover.feed(dt, state, vel, 0, player.facing(), inputYaw);
          const pj = poseJoints(pose);
          world.set(joints.hips, Transform, { pos: [0, pj.hipsY, 0] }).unwrap();
          if (modelJoint.hips) world.set(modelJoint.hips, Transform, { pos: [0, pj.hipsY * RIG_SCALE, 0] }).unwrap();
          for (const [name, e] of Object.entries(pj.rot) as [JointName, V3][]) {
            let rot: V3 = e;
            if (name === 'hips') rot = [e[0], h.pelvisYaw, e[2]];
            else if (name === 'torso') rot = [e[0], e[1] - h.pelvisYaw * 0.8, e[2]];
            else if (name === 'head') rot = [e[0] - h.pitch * 0.55, e[1] + h.headYaw, e[2]];
            else if (name === 'lS' && combat.pose().kind === 'free') rot = [e[0] + h.arm * 0.5, e[1], e[2]];
            setRot(name, rot);
          }
          // 回旋枪: the whole rig turns once (v1.4.0 extra.spin); the root yaw π faces −Z.
          const cp = combat.pose();
          if (cp.kind === 'light' && cp.stage === 4) {
            const spec = DEFAULT_COMBAT.light[3]!;
            spinNow = spinOf(Math.min(1, cp.frame / (spec.hit + spec.recover)));
          } else spinNow = 0;
          const yawR = Math.PI + spinNow;
          world.set(rigRoot, Transform, { quat: [0, Math.sin(yawR / 2), 0, Math.cos(yawR / 2)] }).unwrap();
          trailOn = trailActive();
          // Legs never step: tucked by state and swung by inertia (overrides the pose legs).
          const legs = hover.legs(time);
          setRot('lHip', legs.lHip);
          setRot('rHip', legs.rHip);
          setRot('lK', legs.lK);
          setRot('rK', legs.rK);
          // Upright wheels: cancel the leg bend so they roll level; spin with speed; swell in a roll.
          const speed = Math.hypot(vel.x, vel.z);
          spin += (3 + speed * 7) * dt;
          const full = combat.pose().wheelsFull;
          wheelScale += ((full ? tuning.current.combat.wheelRollScale : 1) - wheelScale) * (1 - Math.exp(-raw * 30));
          const hipsX = pose.hipX;
          setRot('lMount', [-(legs.lHip[0] + legs.lK[0] + hipsX + h.pitch), 0, 0]);
          setRot('rMount', [-(legs.rHip[0] + legs.rK[0] + hipsX + h.pitch), 0, 0]);
          const ql = qEuler(spin * 1.03, 0, 0), qr = qEuler(spin, 0, 0);
          world.set(joints.lWheel, Transform, { quat: [ql[0], ql[1], ql[2], ql[3]], scale: [wheelScale, wheelScale, wheelScale] }).unwrap();
          world.set(joints.rWheel, Transform, { quat: [qr[0], qr[1], qr[2], qr[3]], scale: [wheelScale, wheelScale, wheelScale] }).unwrap();
          if (modelJoint.lWheel) world.set(modelJoint.lWheel, Transform, { quat: [ql[0], ql[1], ql[2], ql[3]], scale: [wheelScale, wheelScale, wheelScale] }).unwrap();
          if (modelJoint.rWheel) world.set(modelJoint.rWheel, Transform, { quat: [qr[0], qr[1], qr[2], qr[3]], scale: [wheelScale, wheelScale, wheelScale] }).unwrap();
          // Afterimages (boss 20:57): dark along the roll (frames 1, 4, 7, 10, 13), pale while moving.
          const cpk = combat.pose();
          const rollF = Math.floor(cpk.frame);
          if (cpk.kind === 'roll' && [1, 4, 7, 10, 13].includes(rollF) && rollF !== lastRollFrame) {
            lastRollFrame = rollF;
            ghosts.spawn(tuning.current.combat.afterimageLife, 1);
          } else if (cpk.kind !== 'roll') lastRollFrame = -1;
          if (dt > 0 && cpk.kind !== 'roll' && cpk.kind !== 'dead' && speed > 1.2) {
            ghostGap -= dt * 60;
            if (ghostGap <= 0) { ghostGap = 6; ghosts.spawn(20, player.mode() === 'sprint' ? 0.2 : 0.13); }
          }
          if (dt > 0) ghosts.step();
          // The model's two sash tails and the 24-strand tassel: procedural flow on their bones (they
          // trail back with speed, ripple along the chain, swing out in the spin).
          if (dt > 0) {
            const sp = Math.min(1.5, speed / 6);
            for (const side of ['L', 'R'] as const) {
              const sgn = side === 'L' ? 1 : -1;
              for (let k = 1; k <= 12; k += 1) {
                const b = sashBones[side][k - 1];
                if (!b) continue;
                const w = time * 3.2 - k * 0.55 + (side === 'L' ? 0 : 1.3);
                const pitch = (k === 1 ? 0.35 * sp : 0.06 * sp) + 0.09 * Math.sin(w) * (0.4 + 0.6 * k / 12);
                const roll = sgn * (0.05 * Math.sin(w * 0.8 + 0.7)) + (spinNow > 0 ? sgn * 0.15 : 0);
                const q = qEuler(pitch, 0, roll);
                world.set(b.e, Transform, { quat: qMulArr(b.rest, q) }).unwrap();
              }
            }
            // 红缨 (boss 11-07): streams back and whips hard while she moves, a light sway at rest.
            const mv = Math.min(1, speed / 7);
            tasselBones.forEach((b, k) => {
              const w = time * (5 + 7 * mv) - k * 0.9;
              const amp = 0.12 + 0.55 * mv;
              const q = qEuler(amp * Math.sin(w) + (k === 0 ? 0.9 : 0.35) * mv, 0, (0.1 + 0.45 * mv) * Math.cos(w * 0.85 + k));
              world.set(b.e, Transform, { quat: qMulArr(b.rest, q) }).unwrap();
            });
          }
          // v1.4.0 flame flicker: halo 0.4–0.65 opacity, size 0.95–1.07 × (1 + speed), light flickers with it.
          if (dt > 0) flick = 0.85 + Math.random() * 0.3;
          const fl = 1 + Math.min(1.5, speed * 0.12);
          const dead = combat.pose().kind === 'dead';
          assets.update(haloMat, { values: { intensity: dead ? 0 : (0.4 + (flick - 0.85) * 0.8) * (full ? 1.6 : 1) } } as never).unwrap();
          for (const w of wheelFx) {
            const hs = (0.95 + (flick - 0.85) * 0.4 * fl) * wheelScale;
            world.set(w.halo, Transform, { scale: [hs, hs, hs] }).unwrap();
            world.set(w.light, PointLight, { intensity: dead ? 0 : (3 + speed * 0.25) * flick * (full ? 1.8 : 1) } as never).unwrap();
          }
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-rig').unwrap();

      // Ribbons after the transforms are propagated (pins read this frame's joint matrices).
      world.addSystem(Update, {
        name: 'nezha-rig-ribbons',
        after: [PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          if (session.phase() === 'paused') return;
          const dt = Math.min(world.getResource(Time).delta, 0.05) * session.clock.nezhaScale();
          ribbonTime += dt;
          const wind: RV3 = [Math.sin(ribbonTime * 0.7) * 1.2, 0, Math.cos(ribbonTime * 0.5) * 1.0];
          const f = player.facing();
          const back: RV3 = [Math.sin(f), 0, Math.cos(f)];
          let v = 0;
          ribbons.forEach((r, i) => {
            r.update(dt, ribbonTime, ribbonDefs[i]!.pin(), wind, back, FLOOR_Y);
            v = r.write(ribbonPos, v, ribbonTime);
          });
          assets.writeRange(ribbonMesh, { attribute: 'position', first: 0, values: ribbonPos }).unwrap();
          // Swing trail: sample the blade and the shaft, age the samples, write the strip.
          const realDt = Math.min(world.getResource(Time).delta, 0.05) * session.clock.nezhaScale();
          for (const smp of samples) smp.age += realDt;
          if (trailOn) samples.unshift({ a: worldPoint(joints.staffPivot, PINS.tip.pos), b: worldPoint(joints.staffPivot, [0, PINS.tip.pos[1] - 1.7, 0]), age: 0 }); // blade half of the long spear only
          while (samples.length > TN || (samples.length && samples[samples.length - 1]!.age >= TLIFE)) samples.pop();
          if (samples.length || trailWasLive) {
            const n = samples.length;
            for (let i = 0; i < TN; i += 1) {
              const smp = samples[Math.min(i, Math.max(0, n - 1))];
              const f = smp && i < n ? (1 - smp.age / TLIFE) * (1 - i / TN) : 0;
              const a = smp ? smp.a : [0, -60, 0] as RV3, b = smp ? smp.b : [0, -60, 0] as RV3;
              trailPos.set(a, i * 6); trailPos.set(b, i * 6 + 3);
              trailUv[i * 4] = Math.max(0, f); trailUv[i * 4 + 2] = Math.max(0, f * 0.15);
            }
            assets.writeRange(trailMesh, { attribute: 'position', first: 0, values: trailPos }).unwrap();
            assets.writeRange(trailMesh, { attribute: 'uv', first: 0, values: trailUv }).unwrap();
            const heavy = combat.pose().kind === 'heavy' || combat.pose().kind === 'airatk';
            assets.update(trailMat, { values: { intensity: heavy ? 3.4 : 2.2 } } as never).unwrap();
          }
          trailWasLive = samples.length > 0;
          // The model's own two sash tails replace the v1.4.0 loop (asset track v2, boss-approved shape).
          void loop; void loopPos; void loopMesh;
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-rig-ribbons').unwrap();
      yield () => {
        for (const name of JOINT_NAMES) world.set(joints[name], Transform, { pos: [...JOINTS[name].pos], quat: [0, 0, 0, 1] }).unwrap();
      };

      yield telemetry.section('rig', () => {
        const o = hover.out;
        return {
          state,
          vel: [r3(vel.x), r3(vel.z)],
          hover: { dy: r3(o.dy), pitch: r3(o.pitch), roll: r3(o.roll), pelvisYaw: r3(o.pelvisYaw), headYaw: r3(o.headYaw), thigh: r3(o.thigh) },
          pose: { tY: r3(pose.tY), rsX: r3(pose.rsX), wX: r3(pose.wX), hipY: r3(pose.hipY) },
          wheelScale: r3(wheelScale),
        };
      });
      yield ctx.provide('nezhaRig', {
        hover: () => hover.out,
        joint: (name) => joints[name],
      } satisfies RigService);
    }, 'nezha/rig');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.rigPlugin,
  build: () => ok({
    'plugin/rig': { kind: 'plugin', module: { specifier: './rig.pack.ts', export: 'nezhaRig' } },
  }),
});
