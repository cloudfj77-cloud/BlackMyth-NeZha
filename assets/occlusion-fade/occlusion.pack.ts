import { definePack } from '@forgeax/engine/pack/source';
import { Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { vec3 } from '@forgeax/engine/math';
import type { PhysicsWorld } from '@forgeax/engine/physics';
import type { Plugin } from '@forgeax/engine/plugin';
import { MeshRenderer, Outline, OutlineOcclusionValue } from '@forgeax/engine/render';
import { PROPAGATE_TRANSFORMS_SYSTEM, readPresentationWorldMatrix } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import { guidText, materialGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';
import { PILLAR_RAY_FILTER } from '../shared/collision.ts';
import { PILLARS } from '../shared/layout.ts';
import { resolveGameEntity } from '../shared/scene-refs.ts';

/**
 * Pillar see-through. When a pillar stands between the camera and Nezha it fades
 * to `occlusion.fadeOpacity` within `occlusion.fadeTime`, with an outline so the
 * silhouette still reads; it never pulls the camera in (dense pillars would shake it).
 *
 * Route A (default): Alpha Hash dithering — opaque queue, depth writes, no sorting.
 * Route B1: four quantised Alpha Hash steps. Route B2 (approved fallback): 35 % blended glass.
 * `?dev=1&fade=hash|steps|glass` selects the route for side-by-side review.
 */
export type FadeRoute = 'hash' | 'steps' | 'glass';

/** Sample points on Nezha (model space height above the seabed root) used for occlusion probes. */
const PROBE_HEIGHTS = [0.55, 1.1, 1.65, 2.0] as const;

interface PillarState {
  readonly id: string;
  readonly entity: EntityHandle;
  opacity: number;
  occluded: boolean;
  /** Game time when the current fade started (QA measures time-to-threshold from it). */
  since: number;
  /** Per-pillar material instance (Alpha Hash copy), created on first fade. */
  instance?: number;
  route?: FadeRoute;
}

export const occlusion: Plugin = {
  name: 'nezha/occlusion',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry'],
  async apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    if (!host || !session || !tuning || !telemetry) throw new Error('nezha/occlusion requires core services');
    const assets = host.assets;
    const camera = resolveGameEntity(world, ctx.gameScene, 'camera');
    const player = resolveGameEntity(world, ctx.gameScene, 'player');
    const pillars: PillarState[] = PILLARS.map((spec) => ({
      id: spec.id,
      entity: resolveGameEntity(world, ctx.gameScene, `pillar/${spec.id}`),
      opacity: 1,
      occluded: false,
      since: 0,
    }));
    const byEntity = new Map(pillars.map((pillar) => [pillar.entity as number, pillar]));
    const load = async (key: string) => {
      const loaded = await assets.load(guidText(materialGuid(key)), 'material');
      if (!loaded.ok) throw loaded.error;
      return loaded.value;
    };
    const fadeMaterial = await load('pillar-fade');
    const glassMaterial = await load('pillar-glass');

    await ctx.effect(function* () {
      yield () => {
        assets.release(fadeMaterial).unwrap();
        assets.release(glassMaterial).unwrap();
      };
      yield () => {
        for (const pillar of pillars) {
          if (pillar.instance !== undefined) assets.release(pillar.instance as never).unwrap();
        }
      };
      const origin = vec3.create();
      const direction = vec3.create();
      let outlined: readonly EntityHandle[] = [];
      let visibleRatio = 1;
      const outlineOn = world.addComponent(camera, {
        component: Outline,
        data: { entities: [], visibleColor: [0.55, 0.85, 0.95], hiddenColor: [0.2, 0.35, 0.42], width: 2, occlusion: OutlineOcclusionValue.all },
      });
      if (outlineOn.ok) yield () => world.removeComponent(camera, Outline).unwrap();

      const route = (): FadeRoute => {
        return session.frontend().fade;
      };
      const apply = (pillar: PillarState, opacity: number) => {
        const selected = route();
        if (opacity >= 0.999) {
          if (pillar.route !== undefined) {
            world.set(pillar.entity, MeshRenderer, { materials: [] }).unwrap();
            pillar.route = undefined;
          }
          return;
        }
        if (selected === 'glass') {
          if (pillar.route !== 'glass') world.set(pillar.entity, MeshRenderer, { materials: [glassMaterial] }).unwrap();
        } else {
          if (pillar.instance === undefined) pillar.instance = assets.copy(fadeMaterial).unwrap() as unknown as number;
          const shown = selected === 'steps' ? Math.max(tuning.current.occlusion.fadeOpacity, Math.ceil(opacity * 4) / 4) : opacity;
          assets.update(pillar.instance as never, { values: { fade: shown } } as never).unwrap();
          if (pillar.route !== selected) world.set(pillar.entity, MeshRenderer, { materials: [pillar.instance as never] }).unwrap();
        }
        pillar.route = selected;
      };

      world.addSystem(Update, {
        name: 'nezha-occlusion',
        after: ['nezha-camera'],
        before: [PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const now = world.getResource(Time).elapsed;
          const dt = Math.min(world.getResource(Time).delta, 0.1);
          const cam = readPresentationWorldMatrix(world, camera);
          const body = readPresentationWorldMatrix(world, player);
          const forced = session.frontend().lab === 'force';
          const hits = new Set<number>();
          let clearProbes = 0;
          if (cam && body && world.hasResource('PhysicsWorld')) {
            const physics = world.getResource<PhysicsWorld>('PhysicsWorld');
            const cx = cam[12] ?? 0, cy = cam[13] ?? 0, cz = cam[14] ?? 0;
            // Root is the capsule centre; probe heights are above the seabed (centre - half capsule height).
            const groundY = (body[13] ?? 0) - tuning.current.move.capsuleHeight / 2;
            for (const height of PROBE_HEIGHTS) {
              const tx = body[12] ?? 0, ty = groundY + height, tz = body[14] ?? 0;
              const dx = tx - cx, dy = ty - cy, dz = tz - cz;
              const distance = Math.hypot(dx, dy, dz);
              if (distance < 1e-3) continue;
              vec3.set(origin, cx, cy, cz);
              vec3.set(direction, dx / distance, dy / distance, dz / distance);
              let hit;
              try {
                hit = physics.raycast(origin, direction, distance, PILLAR_RAY_FILTER);
              } catch {
                hit = undefined;
              }
              if (hit && byEntity.has(hit.entity)) hits.add(hit.entity);
              else clearProbes += 1;
            }
          }
          if (forced) hits.add(pillars.find((p) => p.id === 'canyon-1')!.entity as number);
          const target = tuning.current.occlusion.fadeOpacity;
          const rate = (1 - target) / Math.max(0.01, tuning.current.occlusion.fadeTime);
          const nowOutlined: EntityHandle[] = [];
          for (const pillar of pillars) {
            const occluded = hits.has(pillar.entity as number);
            if (occluded !== pillar.occluded) {
              pillar.occluded = occluded;
              pillar.since = now;
            }
            const goal = occluded ? target : 1;
            const step = rate * dt;
            pillar.opacity = goal < pillar.opacity ? Math.max(goal, pillar.opacity - step) : Math.min(goal, pillar.opacity + step);
            apply(pillar, pillar.opacity);
            if (pillar.opacity < 0.999) nowOutlined.push(pillar.entity);
          }
          if (route() !== 'glass') nowOutlined.length = 0;
          if (route() !== 'glass') nowOutlined.length = 0;
          if (outlineOn.ok && (nowOutlined.length !== outlined.length || nowOutlined.some((e, i) => e !== outlined[i]))) {
            outlined = nowOutlined;
            world.set(camera, Outline, { entities: nowOutlined }).unwrap();
          }
          // Faded pillars count as see-through; only fully opaque blockers hide Nezha.
          const blockedByOpaque = [...hits].filter((entity) => (byEntity.get(entity)?.opacity ?? 1) > 0.5).length;
          visibleRatio = PROBE_HEIGHTS.length > 0 ? (clearProbes + (hits.size - blockedByOpaque)) / PROBE_HEIGHTS.length : 1;
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-occlusion').unwrap();

      yield telemetry.section('occlusion', () => ({
        route: route(),
        outline: outlineOn.ok,
        nezhaVisibleRatio: visibleRatio,
        pillars: pillars
          .filter((pillar) => pillar.occluded || pillar.opacity < 0.999)
          .map((pillar) => ({ id: pillar.id, opacity: Math.round(pillar.opacity * 1000) / 1000, occluded: pillar.occluded, since: pillar.since })),
      }));
    }, 'nezha/occlusion');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.occlusionPlugin,
  build: () => ok({
    'plugin/occlusion': { kind: 'plugin', module: { specifier: './occlusion.pack.ts', export: 'occlusion' } },
  }),
});
