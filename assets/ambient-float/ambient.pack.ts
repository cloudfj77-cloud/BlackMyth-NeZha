import { definePack } from '@forgeax/engine/pack/source';
import { Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { packInterleavedVertexAttributes } from '@forgeax/engine/geometry';
import { quat } from '@forgeax/engine/math';
import type { Plugin } from '@forgeax/engine/plugin';
import { MeshFilter, MeshRenderer, Points, PointShapeValue, PointSizeUnitsValue } from '@forgeax/engine/render';
import { ChildOf, PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import type { MeshAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type {} from '@forgeax/engine/assets-runtime';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import { geometryGuid, guidText, materialGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';
import { BEAM, seeded } from '../shared/layout.ts';
import { resolveGameEntity } from '../shared/scene-refs.ts';
import { placeSeaweed, swayAngle, type SeaweedGroup } from './placement.ts';

const r3 = (value: number) => Math.round(value * 1000) / 1000;
const PARTICLE_BOUNDS = [-30, 0.2, -26, 30, 9, 52] as const;

function pointCloud(count: number): MeshAsset {
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const tangent = new Float32Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    normal[index * 3 + 2] = 1;
    tangent[index * 4] = 1;
    tangent[index * 4 + 3] = 1;
  }
  const attributes = { position, normal, uv: new Float32Array(count * 2), tangent };
  const packed = packInterleavedVertexAttributes(attributes, count);
  if (!packed.ok) throw packed.error;
  return {
    kind: 'mesh',
    vertices: packed.value.vertices,
    attributes,
    aabb: new Float32Array(PARTICLE_BOUNDS),
    submeshes: [{ indexOffset: 0, indexCount: 0, vertexCount: count, topology: 'point-list', materialSlot: 0 }],
    materialSlots: [{ slotName: 'particles' }],
  };
}

/**
 * Environment float, minimum M1 version: seaweed clumps (instanced blades) and
 * suspended particles, all ≤ 0.25 Hz and moving the same way as one current;
 * plus the slow sway of the plaza light beam. Counts follow tuning live.
 */
export const ambient: Plugin = {
  name: 'nezha/ambient-float',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry'],
  async apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const session = ctx.nezhaSession as SessionService | undefined;
    if (!session) throw new Error('nezha/ambient-float requires the session');
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    if (!host || !tuning || !telemetry) throw new Error('nezha/ambient-float requires core services');
    const assets = host.assets;
    const beam = resolveGameEntity(world, ctx.gameScene, 'beam');
    const bladeMesh = await assets.load(guidText(geometryGuid('seaweed-blade')), 'mesh');
    if (!bladeMesh.ok) throw bladeMesh.error;
    const seaweedMaterial = await assets.load(guidText(materialGuid('seaweed')), 'material');
    if (!seaweedMaterial.ok) throw seaweedMaterial.error;
    const particleMaterial = await assets.load(guidText(materialGuid('particle')), 'material');
    if (!particleMaterial.ok) throw particleMaterial.error;

    await ctx.effect(function* () {
      yield () => {
        for (const handle of [bladeMesh.value, seaweedMaterial.value, particleMaterial.value]) assets.release(handle as never).unwrap();
      };
      interface LiveClump { readonly entity: EntityHandle; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }
      let clumps: LiveClump[] = [];
      let blades: EntityHandle[] = [];
      let counts = { canyon: -1, edge: -1, far: -1 };
      let particleMesh: number | undefined;
      let particleEntity: EntityHandle | undefined;
      let particleCount = -1;
      let base = new Float32Array(0);
      let positions = new Float32Array(0);
      const rotation = quat.create();

      const clearSeaweed = () => {
        for (const entity of blades) world.despawn(entity).unwrap();
        for (const clump of clumps) world.despawn(clump.entity).unwrap();
        blades = [];
        clumps = [];
      };
      const plant = () => {
        clearSeaweed();
        const a = tuning.current.ambient;
        counts = { canyon: Math.round(a.seaweedCanyon), edge: Math.round(a.seaweedEdge), far: Math.round(a.seaweedFar) };
        for (const group of ['canyon', 'edge', 'far'] as SeaweedGroup[]) {
          for (const clump of placeSeaweed(group, counts[group], a.seaweedMaxHeight)) {
            const yaw = 0;
            const parent = world.spawn({ component: Transform, data: { pos: [clump.x, clump.y, clump.z] } }).unwrap();
            clumps.push({ entity: parent, x: clump.x, y: clump.y, z: clump.z, yaw });
            for (const blade of clump.blades) {
              quat.fromEuler(rotation, blade.lean, blade.yaw, 0, 'YXZ');
              blades.push(world.spawn(
                { component: Transform, data: { pos: [blade.x, blade.y, blade.z], quat: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!], scale: [1, blade.height, 1] } },
                { component: ChildOf, data: { parent } },
                { component: MeshFilter, data: { assetHandle: bladeMesh.value } as never },
                { component: MeshRenderer, data: { materials: [seaweedMaterial.value] } as never },
              ).unwrap());
            }
          }
        }
      };
      const clearParticles = () => {
        if (particleEntity !== undefined) world.despawn(particleEntity).unwrap();
        if (particleMesh !== undefined) assets.release(particleMesh as never).unwrap();
        particleEntity = undefined;
        particleMesh = undefined;
      };
      const scatter = () => {
        clearParticles();
        particleCount = Math.round(tuning.current.ambient.particles);
        if (particleCount <= 0) return;
        const random = seeded(77);
        base = new Float32Array(particleCount * 4);
        positions = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount; i += 1) {
          base.set([
            PARTICLE_BOUNDS[0] + random() * (PARTICLE_BOUNDS[3] - PARTICLE_BOUNDS[0]),
            PARTICLE_BOUNDS[1] + random() * (PARTICLE_BOUNDS[4] - PARTICLE_BOUNDS[1]),
            PARTICLE_BOUNDS[2] + random() * (PARTICLE_BOUNDS[5] - PARTICLE_BOUNDS[2]),
            random() * Math.PI * 2,
          ], i * 4);
        }
        const handle = assets.create(pointCloud(particleCount)).unwrap();
        particleMesh = handle as unknown as number;
        particleEntity = world.spawn(
          { component: Transform, data: { pos: [0, 0, 0] } },
          { component: MeshFilter, data: { assetHandle: handle } as never },
          { component: MeshRenderer, data: { materials: [particleMaterial.value] } as never },
          { component: Points, data: { size: 0.045, sizeUnits: PointSizeUnitsValue.world, shape: PointShapeValue.soft } as never },
        ).unwrap();
      };
      plant();
      scatter();
      yield () => {
        clearSeaweed();
        clearParticles();
      };

      let sample = 0;
      // World clock: environment float follows the world time scale (hitstop stops it, slow motion slows it).
      let worldTime = 0;
      world.addSystem(Update, {
        name: 'nezha-ambient',
        before: [PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const a = tuning.current.ambient;
          if (Math.round(a.seaweedCanyon) !== counts.canyon || Math.round(a.seaweedEdge) !== counts.edge || Math.round(a.seaweedFar) !== counts.far) plant();
          if (Math.round(a.particles) !== particleCount) scatter();
          const realDt = Math.min(world.getResource(Time).delta, 0.1);
          worldTime += realDt * (session.phase() === 'playing' ? session.clock.worldScale() : 1);
          const time = worldTime;
          const hz = Math.min(0.25, a.seaweedSwayHz);
          // One current: a common sway axis (lean toward +X/-Z and back).
          for (const clump of clumps) {
            const angle = swayAngle(time, hz, clump.x, clump.z, clump.y > 1 ? 0.1 : 0.16);
            quat.fromEuler(rotation, angle * 0.6, 0, angle, 'YXZ');
            world.set(clump.entity, Transform, { quat: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!] }).unwrap();
          }
          sample = clumps.length > 0 ? swayAngle(time, hz, clumps[0]!.x, clumps[0]!.z) : 0;
          // Particles drift with the same current (≤ particleDriftHz), never ice-cyan.
          if (particleMesh !== undefined) {
            const drift = Math.min(0.25, a.particleDriftHz);
            for (let i = 0; i < particleCount; i += 1) {
              const phase = base[i * 4 + 3]!;
              const w = 2 * Math.PI * drift * time + phase;
              positions[i * 3] = base[i * 4]! + 0.35 * Math.sin(w);
              positions[i * 3 + 1] = base[i * 4 + 1]! + 0.25 * Math.sin(w * 0.7 + 1.3);
              positions[i * 3 + 2] = base[i * 4 + 2]! - 0.3 * Math.sin(w + 0.6);
            }
            assets.writeRange(particleMesh as never, { attribute: 'position', first: 0, values: positions }).unwrap();
          }
          // Light beam: slow pendulum (period beamSwayPeriod).
          const swing = ((BEAM.swayDeg * Math.PI) / 180) * Math.sin((2 * Math.PI * time) / Math.max(4, a.beamSwayPeriod));
          quat.fromEuler(rotation, swing * 0.5, 0, swing, 'YXZ');
          world.set(beam, Transform, { quat: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!] }).unwrap();
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-ambient').unwrap();

      yield telemetry.section('ambient', () => ({
        seaweed: { ...counts, total: blades.length, clumps: clumps.length },
        swayHz: Math.min(0.25, tuning.current.ambient.seaweedSwayHz),
        swaySample: r3(sample),
        particles: particleCount,
      }));
    }, 'nezha/ambient-float');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.ambientPlugin,
  build: () => ok({
    'plugin/ambient': { kind: 'plugin', module: { specifier: './ambient.pack.ts', export: 'ambient' } },
  }),
});
