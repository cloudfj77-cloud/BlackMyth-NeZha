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
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import { PILLAR_RAY_FILTER } from '../shared/collision.ts';

/** Level geometry (group 1) + pillars (group 5): what can hide Nezha from the lens. */
const VIEW_RAY_FILTER = 0xffff_0011 >>> 0;
import { ARENA_PILLARS as PILLARS } from '../shared/sea-layout.ts';
/** Platform dragon pillars have four material slots (stone, shaft, scales, gold); a fade covers all. */
const PILLAR_SLOTS = 4;
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
  /** Game time when opacity first reached ≤ 0.4 in the current fade (undefined until then). */
  belowAt?: number;
  /** Per-pillar material instance (Alpha Hash copy), created on first fade. */
  instance?: number;
  route?: FadeRoute;
}

export const occlusion: Plugin = {
  name: 'nezha/occlusion',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer'],
  async apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    const playerService = ctx.nezhaPlayer as PlayerService | undefined;
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
          if (pillar.route !== 'glass') world.set(pillar.entity, MeshRenderer, { materials: Array(PILLAR_SLOTS).fill(glassMaterial) }).unwrap();
        } else {
          if (pillar.instance === undefined) pillar.instance = assets.copy(fadeMaterial).unwrap() as unknown as number;
          const shown = selected === 'steps' ? Math.max(tuning.current.occlusion.fadeOpacity, Math.ceil(opacity * 4) / 4) : opacity;
          assets.update(pillar.instance as never, { values: { fade: shown } } as never).unwrap();
          if (pillar.route !== selected) world.set(pillar.entity, MeshRenderer, { materials: Array(PILLAR_SLOTS).fill(pillar.instance as never) }).unwrap();
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
            const flyY = groundY + (playerService?.altitude() ?? 0);
            for (const height of PROBE_HEIGHTS) {
              const tx = body[12] ?? 0, ty = flyY + height, tz = body[14] ?? 0;
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
              pillar.belowAt = undefined;
            }
            const goal = occluded ? target : 1;
            const step = rate * dt;
            pillar.opacity = goal < pillar.opacity ? Math.max(goal, pillar.opacity - step) : Math.min(goal, pillar.opacity + step);
            if (pillar.occluded && pillar.belowAt === undefined && pillar.opacity <= 0.4) pillar.belowAt = now;
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

      /**
       * Nezha's visible share from the lens: 200 rays toward points spread over his body volume
       * (8 heights × 25 around/through a 0.22 m cylinder). A ray counts as blocked only when it first
       * hits level geometry or a pillar that is still mostly opaque (faded pillars are see-through).
       */
      const visibleFraction = (): number | null => {
        const cam = readPresentationWorldMatrix(world, camera);
        const body = readPresentationWorldMatrix(world, player);
        if (!cam || !body || !world.hasResource('PhysicsWorld')) return null;
        const physics = world.getResource<PhysicsWorld>('PhysicsWorld');
        const cx = cam[12] ?? 0, cy = cam[13] ?? 0, cz = cam[14] ?? 0;
        const groundY = (body[13] ?? 0) - tuning.current.move.capsuleHeight / 2;
        let clear = 0, total = 0;
        for (let level = 0; level < 8; level += 1) {
          const y = groundY + tuning.current.move.hoverHeight + 0.15 + (level / 7) * 1.55;
          for (let k = 0; k < 25; k += 1) {
            const angle = (k / 25) * Math.PI * 2;
            const radius = 0.22 * ((k % 5) / 4);
            const tx = (body[12] ?? 0) + Math.cos(angle) * radius, tz = (body[14] ?? 0) + Math.sin(angle) * radius;
            const dx = tx - cx, dy = y - cy, dz = tz - cz;
            const d = Math.hypot(dx, dy, dz);
            total += 1;
            if (d < 1e-3) continue;
            vec3.set(origin, cx, cy, cz);
            vec3.set(direction, dx / d, dy / d, dz / d);
            let hit;
            try {
              hit = physics.raycast(origin, direction, d - 0.3, VIEW_RAY_FILTER);
            } catch {
              hit = undefined;
            }
            const pillar = hit ? byEntity.get(hit.entity) : undefined;
            if (!hit || (pillar && pillar.opacity <= 0.5)) clear += 1;
          }
        }
        return Math.round((clear / total) * 1000) / 1000;
      };
      yield telemetry.section('occlusion', () => ({
        route: route(),
        outline: outlineOn.ok,
        nezhaVisibleRatio: visibleRatio,
        pillars: pillars
          .filter((pillar) => pillar.occluded || pillar.opacity < 0.999)
          .map((pillar) => ({
            id: pillar.id,
            opacity: Math.round(pillar.opacity * 1000) / 1000,
            occluded: pillar.occluded,
            since: pillar.since,
            fadeToBelow04: pillar.belowAt === undefined ? null : Math.round((pillar.belowAt - pillar.since) * 1000) / 1000,
          })),
        nezhaVisible200: visibleFraction(),
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
