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

    await ctx.effect(function* () {
      yield () => assets.release(silk).unwrap();
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
      // --- Extra ribbons (v1.4.0): arm sash, waist sash, hair ribbons, spear tassel — one mesh, one draw.
      const S = RIG_SCALE;
      const ribbonDefs: { pin: () => RV3; spec: ReturnType<typeof ribbonSpec> }[] = [];
      const atJoint = (name: JointName, local: V3) => () => worldPoint(joints[name], local);
      ribbonDefs.push({ pin: atJoint(PINS.armL.joint, PINS.armL.pos), spec: ribbonSpec({ n: 22, len: 2.0 * S, width: 0.11 * S, gravity: -0.8, flutter: 6, taper: 0.6, twist: 1.1, back: 4 }, 1.3) });
      ribbonDefs.push({ pin: atJoint(PINS.waist.joint, PINS.waist.pos), spec: ribbonSpec({ n: 20, len: 1.7 * S, width: 0.1 * S, gravity: -1.2, flutter: 6, taper: 0.6, twist: 1.1, back: 4 }, 2.7) });
      ribbonDefs.push({ pin: atJoint(PINS.bunL.joint, PINS.bunL.pos), spec: ribbonSpec({ n: 9, len: 0.6 * S, width: 0.045 * S, gravity: -1.5, flutter: 5, taper: 0.4, back: 2.5 }, 4.1) });
      ribbonDefs.push({ pin: atJoint(PINS.bunR.joint, PINS.bunR.pos), spec: ribbonSpec({ n: 9, len: 0.6 * S, width: 0.045 * S, gravity: -1.5, flutter: 5, taper: 0.4, back: 2.5 }, 5.9) });
      for (let k = 0; k < 6; k += 1) {
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
            const stage = Math.max(1, Math.min(3, c.stage));
            const spec = DEFAULT_COMBAT.light[stage - 1]!;
            return { pose: keyframes(P_IDLE, LIGHT_KF[stage - 1]!, Math.min(1, c.frame / (spec.hit + spec.recover))), rate: 22, hs: 'attack' };
          }
          case 'charge':
            return { pose: { ...P_IDLE, ...HC, tX: (HC.tX ?? 0) + Math.sin(time * 40) * 0.01 * Math.min(1, c.charge / DEFAULT_COMBAT.chargeMax) * 3 }, rate: 16, hs: 'charge' };
          case 'heavy':
            return { pose: keyframes(P_IDLE, HEAVY_KF, Math.min(1, c.frame / HEAVY_STEPS)), rate: 22, hs: 'heavy' };
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
          for (const [name, e] of Object.entries(pj.rot) as [JointName, V3][]) {
            let rot: V3 = e;
            if (name === 'hips') rot = [e[0], h.pelvisYaw, e[2]];
            else if (name === 'torso') rot = [e[0], e[1] - h.pelvisYaw * 0.8, e[2]];
            else if (name === 'head') rot = [e[0] - h.pitch * 0.55, e[1] + h.headYaw, e[2]];
            else if (name === 'lS' && combat.pose().kind === 'free') rot = [e[0] + h.arm * 0.5, e[1], e[2]];
            setRot(name, rot);
          }
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
          loop.update(dt, ribbonTime, worldPoint(joints[PINS.backL.joint], PINS.backL.pos), wind, back, FLOOR_Y, worldPoint(joints[PINS.backR.joint], PINS.backR.pos));
          loop.write(loopPos, 0, ribbonTime);
          assets.writeRange(loopMesh, { attribute: 'position', first: 0, values: loopPos }).unwrap();
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
