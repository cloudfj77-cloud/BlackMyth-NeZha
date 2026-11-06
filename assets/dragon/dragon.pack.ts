import { definePack } from '@forgeax/engine/pack/source';
import { FixedUpdate, Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { createMeshBuilder } from '@forgeax/engine/geometry';
import { quat } from '@forgeax/engine/math';
import type { Plugin } from '@forgeax/engine/plugin';
import { MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { PROPAGATE_TRANSFORMS_SYSTEM, readPresentationWorldMatrix, Transform } from '@forgeax/engine/scene';
import type { MeshAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type {} from '@forgeax/engine/assets-runtime';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import { geometryGuid, guidText, materialGuid, PACKAGE_IDS } from '../shared/asset-refs.ts';
import { ARENA, FLOOR_Y } from '../shared/layout.ts';
import { CAPSULE_CENTER_Y } from '../shared/player-rig.ts';
import { resolveGameEntity } from '../shared/scene-refs.ts';
import {
  ATTACKS,
  closestOnSegment,
  frontNearest,
  HITTABLE_UNDERSIDE,
  HURT_TOP,
  hurtCapsules,
  POINTS,
  radius,
  type AttackKind,
  type P3,
  type Polygon,
  type V2,
  type Zone,
  COIL,
  smooth,
  zoneDistance,
} from './body.ts';
import { BRAIN, createBrain, INTRO, type DragonEvent } from './brain.ts';

const r3 = (value: number) => Math.round(value * 1000) / 1000;
const DEG = Math.PI / 180;

export interface DragonStrike {
  readonly hit: boolean;
  readonly distance: number;
  readonly angleDeg: number;
  readonly point: V2;
  readonly segment: number;
  readonly tail: boolean;
}

export interface DragonService {
  readonly points: () => readonly P3[];
  /** Hit test of a melee strike (horizontal, from the body surface, ±arc, underside ≤ 2.5 m, nearest capsule). */
  readonly strike: (x: number, z: number, facing: number, range: number, arcDeg: number) => DragonStrike;
  /** Horizontal distance from (x, z) to the front 11 m surface (lock / sash range). */
  readonly frontDistance: (x: number, z: number) => number;
  /** Horizontal distance to the nearest low body part (heavy lunge contact). */
  readonly lowDistance: (x: number, z: number) => number;
  readonly frontNearest: (x: number, z: number) => { readonly x: number; readonly z: number; readonly y: number };
  /** Push (x, z) out of low body parts (Nezha cannot hover through the body). */
  readonly pushOut: (x: number, z: number, margin: number) => { readonly x: number; readonly z: number };
  /** A landed hit: 'phase' at half health (the phase change starts), 'ignored' while invulnerable. */
  readonly damage: (amount: number, segment: number) => 'ignored' | 'hurt' | 'phase' | 'dead';
  readonly phase: () => 1 | 2;
  readonly vulnerable: () => boolean;
  /** Intro (M4 §1): leave the lurk and play the script; skip jumps the body along it. */
  readonly beginIntro: () => void;
  readonly skipIntroTo: (k: number) => void;
  /** Defeat: drop the attack in progress and stop threatening. */
  readonly calm: () => void;
  /** Extra condition for the fight being on (the run's stage). */
  readonly setEngagedRule: (rule: (() => boolean) | undefined) => void;
  readonly head: () => P3;
  /** Sash Bind: the dragon's clock stops for `steps` (world-clock) steps. */
  readonly bind: (steps: number) => void;
  readonly bound: () => boolean;
  readonly opening: () => boolean;
  readonly alive: () => boolean;
  readonly hp: () => { readonly hp: number; readonly max: number };
  readonly engaged: () => boolean;
  /** Events since the last call (telegraph, hit, opening-end, dead, dead-done). */
  readonly drain: () => DragonEvent[];
  /** A new dragon: 'lurk' behind the wall for the intro, or 'fight' (retry, intro skipped). */
  readonly reset: (start: 'fight' | 'lurk', transitionSeen: boolean) => void;
  /** 1 normally, falls to 0 while the dragon dies (the vortex stops at step 150). */
  readonly vortexSpeed: () => number;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    nezhaDragon: DragonService;
  }
}

/** Band of the body each point belongs to: front (#7FA295), mid (#587A6D), tail (#25342E). */
const bandOf = (i: number) => (i <= 12 ? 0 : i <= 26 ? 1 : 2);
const BAND_COLORS: readonly (readonly [number, number, number])[] = [
  [0.2122, 0.3613, 0.3005],
  [0.0976, 0.1946, 0.1529],
  [0.0185, 0.0343, 0.0273],
];
const FADES = [1, 0.75, 0.5, 0.35] as const;
/** A body part whose surface is this close to the lens is not drawn (the camera never sits inside the dragon). */
const LENS_HIDE = 0.5;

/** Warning mesh capacity: outline points (the lash hull has ~180; the coil circle uses 128). */
const WARN_CAP = 256;
const RING_POINTS = 128;

/**
 * Warning meshes are built once and reused (M4 §12: no mesh creation in the frame a telegraph
 * starts). A telegraph only rewrites the positions; unused outline slots repeat the last point,
 * so their triangles collapse to nothing.
 */
function warnMesh(kind: 'fan' | 'band'): MeshAsset {
  const n = WARN_CAP;
  const count = kind === 'fan' ? n + 1 : 2 * n;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) normal[i * 3 + 1] = 1;
  const indices: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    if (kind === 'fan') indices.push(0, 1 + i, 1 + j);
    else indices.push(i, j, n + j, i, n + j, n + i);
  }
  const built = createMeshBuilder({
    attributes: { position, normal, uv: new Float32Array(count * 2) },
    indices: new Uint32Array(indices),
    submeshes: [{ indexOffset: 0, indexCount: indices.length, vertexCount: count, topology: 'triangle-list', materialSlot: 0 }],
    materialSlots: [{ slotName: 'warning' }],
  }).build();
  if (!built.ok) throw built.error;
  return { ...built.value, aabb: new Float32Array([-40, -1, -40, 40, 1, 40]) };
}

/** Inward offset of a CCW outline (vertex normals from the neighbouring edges). */
function insetOf(poly: Polygon, inset: number): V2[] {
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n]!, b = poly[(i + 1) % n]!;
    const ex = b.x - a.x, ez = b.z - a.z;
    const len = Math.hypot(ex, ez) || 1;
    // CCW in (x, z): the inward normal of the tangent (ex, ez) is (-ez, ex).
    return { x: p.x - (ez / len) * inset, z: p.z + (ex / len) * inset };
  });
}
const at = (list: readonly V2[], i: number) => list[Math.min(i, list.length - 1)]!;
/** Fan positions: centre + outline (relative to `origin`). */
function fanPositions(poly: Polygon, origin: V2): Float32Array {
  const out = new Float32Array((WARN_CAP + 1) * 3);
  const c = { x: poly.reduce((a, p) => a + p.x, 0) / poly.length, z: poly.reduce((a, p) => a + p.z, 0) / poly.length };
  out.set([c.x - origin.x, 0, c.z - origin.z], 0);
  for (let i = 0; i < WARN_CAP; i += 1) {
    const p = at(poly, i);
    out.set([p.x - origin.x, 0, p.z - origin.z], (1 + i) * 3);
  }
  return out;
}
/** Band positions between two outlines with the same point count (relative to `origin`). */
function bandPositions(outer: readonly V2[], inner: readonly V2[], origin: V2): Float32Array {
  const out = new Float32Array(2 * WARN_CAP * 3);
  for (let i = 0; i < WARN_CAP; i += 1) {
    const a = at(outer, i), b = at(inner, i);
    out.set([a.x - origin.x, 0, a.z - origin.z], i * 3);
    out.set([b.x - origin.x, 0, b.z - origin.z], (WARN_CAP + i) * 3);
  }
  return out;
}
/** CCW circle (angle 0 = +Z toward +X is clockwise seen from above, so walk it backwards). */
function circle(c: V2, r: number): V2[] {
  return Array.from({ length: RING_POINTS }, (_, k) => {
    const a = -(k / RING_POINTS) * Math.PI * 2;
    return { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r };
  });
}

function lookQuat(dir: P3): [number, number, number, number] {
  const q = quat.fromLookAt(quat.create(), [0, 0, 0], dir, [0, 1, 0]);
  return [q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 1];
}
function segmentQuat(a: P3, b: P3): [number, number, number, number] {
  // Rotation taking +Y onto (b - a).
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  const w = 1 + uy;
  if (w < 1e-6) return [1, 0, 0, 0];
  const q: [number, number, number, number] = [uz, 0, -ux, w];
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/**
 * The Dragon King (M3 greybox): one spine of 41 points drives 40 capsule segments, the
 * placeholder head, the hurt capsules and the ground warnings. Runs on the world clock
 * (slow motion slows it, hitstop stops it); Sash Bind stops its own clock.
 */
export const dragon: Plugin = {
  name: 'nezha/dragon',
  provide: 'nezhaDragon',
  inject: ['world', 'gameHost', 'gameScene', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer'],
  async apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    const player = ctx.nezhaPlayer as PlayerService | undefined;
    if (!host || !session || !tuning || !telemetry || !player) throw new Error('nezha/dragon requires core and player services');
    const assets = host.assets;
    const cameraEntity = resolveGameEntity(world, ctx.gameScene, 'camera');
    const load = async (guid: string, kind: 'material' | 'mesh') => {
      const loaded = await assets.load(guid, kind);
      if (!loaded.ok) throw loaded.error;
      return loaded.value as never;
    };
    const mesh = {
      segment: await load(guidText(geometryGuid('dragon-segment')), 'mesh'),
      joint: await load(guidText(geometryGuid('dragon-joint')), 'mesh'),
      fin: await load(guidText(geometryGuid('dragon-fin')), 'mesh'),
      head: await load(guidText(geometryGuid('dragon-head')), 'mesh'),
      eyes: await load(guidText(geometryGuid('dragon-eyes')), 'mesh'),
      coilWall: await load(guidText(geometryGuid('coil-wall')), 'mesh'),
    };
    const mat = {
      bands: [await load(guidText(materialGuid('dragon-front')), 'material'), await load(guidText(materialGuid('dragon-mid')), 'material'), await load(guidText(materialGuid('dragon-tail')), 'material')],
      glass: [await load(guidText(materialGuid('dragon-front-glass')), 'material'), await load(guidText(materialGuid('dragon-mid-glass')), 'material'), await load(guidText(materialGuid('dragon-tail-glass')), 'material')],
      ridge: await load(guidText(materialGuid('dragon-ridge')), 'material'),
      horn: await load(guidText(materialGuid('dragon-horn')), 'material'),
      eye: await load(guidText(materialGuid('dragon-eye')), 'material'),
      fade: await load(guidText(materialGuid('pillar-fade')), 'material'),
      fill: await load(guidText(materialGuid('warn-fill')), 'material'),
      edge: await load(guidText(materialGuid('warn-edge')), 'material'),
      shrink: await load(guidText(materialGuid('warn-shrink')), 'material'),
      wall: await load(guidText(materialGuid('water-wall')), 'material'),
    };

    await ctx.effect(function* () {
      const copies: number[] = [];
      const spawned: EntityHandle[] = [];
      const meshes: number[] = [];
      yield () => {
        for (const e of spawned) world.despawn(e).unwrap();
        for (const c of copies) assets.release(c as never).unwrap();
        for (const m of meshes) assets.release(m as never).unwrap();
        for (const h of [...Object.values(mesh), mat.ridge, mat.horn, mat.eye, mat.fade, mat.fill, mat.edge, mat.shrink, mat.wall, ...mat.bands, ...mat.glass]) assets.release(h).unwrap();
      };
      const copy = (handle: never, values?: Record<string, unknown>) => {
        const c = assets.copy(handle).unwrap() as unknown as number;
        copies.push(c);
        if (values) assets.update(c as never, { values } as never).unwrap();
        return c as never;
      };
      const spawn = (meshHandle: never, materials: never[]) => {
        const e = world.spawn(
          { component: Transform, data: { pos: [0, -60, 0], scale: [0, 0, 0] } },
          { component: MeshFilter, data: { assetHandle: meshHandle } as never },
          { component: MeshRenderer, data: { materials } as never },
        ).unwrap();
        spawned.push(e);
        return e;
      };
      // Per band: solid, plus the see-through route. Default「毛玻璃」(35 % blended, boss 15:54, same as the
      // pillars); ?dev=1&fade=hash keeps the screen-door levels for comparison.
      const hashMats = mat.bands.map((solid, b) => [
        solid,
        ...FADES.slice(1).map((fade) => copy(mat.fade, { baseColor: [...BAND_COLORS[b]!, 1], rimColor: [BAND_COLORS[b]![0] * 1.4, BAND_COLORS[b]![1] * 1.4, BAND_COLORS[b]![2] * 1.4, 1], fade })),
      ]);
      const glassMats = mat.bands.map((solid, b) => [solid, mat.glass[b]!, mat.glass[b]!, mat.glass[b]!]);
      const routeMats = () => (session.frontend().fade === 'hash' ? hashMats : glassMats);
      const bandMats = glassMats;
      const joints = Array.from({ length: POINTS }, (_, i) => ({ entity: spawn(mesh.joint, [bandMats[bandOf(i)]![0]!]), level: 0 }));
      const segs = Array.from({ length: POINTS - 1 }, (_, i) => ({ entity: spawn(mesh.segment, [bandMats[bandOf(i)]![0]!]), level: 0 }));
      const fins = Array.from({ length: 19 }, () => spawn(mesh.fin, [mat.ridge]));
      const head = spawn(mesh.head, [bandMats[0]![0]!, mat.horn, mat.ridge]);
      const eyeMat = copy(mat.eye);
      const eyes = spawn(mesh.eyes, [eyeMat]);
      // Warning entities (M4 §12): meshes built once; a telegraph only rewrites positions.
      const fillMat = copy(mat.fill);
      const shrinkMat = copy(mat.shrink);
      const pool = { fan: assets.create(warnMesh('fan')).unwrap(), ring: assets.create(warnMesh('band')).unwrap(), edgeA: assets.create(warnMesh('band')).unwrap(), edgeB: assets.create(warnMesh('band')).unwrap(), shrink: assets.create(warnMesh('band')).unwrap() };
      for (const m of Object.values(pool)) meshes.push(m as unknown as number);
      const warn = {
        fan: spawn(pool.fan as never, [fillMat]),
        ring: spawn(pool.ring as never, [fillMat]),
        edgeA: spawn(pool.edgeA as never, [mat.edge]),
        edgeB: spawn(pool.edgeB as never, [mat.edge]),
        shrink: spawn(pool.shrink as never, [shrinkMat]),
      };
      let warnUp = false;
      const clearWarning = () => {
        for (const e of Object.values(warn)) world.set(e, Transform, { pos: [0, -60, 0], scale: [0, 0, 0] }).unwrap();
        warnUp = false;
      };
      yield clearWarning;
      let warnCentre: V2 = { x: 0, z: 0 };
      const write = (m: unknown, values: Float32Array) => assets.writeRange(m as never, { attribute: 'position', first: 0, values }).unwrap();
      const ORIGIN: V2 = { x: 0, z: 0 };
      const showWarning = (zone: Zone) => {
        clearWarning();
        const place = (e: EntityHandle, y: number) => world.set(e, Transform, { pos: [0, FLOOR_Y + y, 0], scale: [1, 1, 1] }).unwrap();
        if (zone.kind === 'poly') {
          const poly = zone.poly;
          warnCentre = { x: poly.reduce((a, p) => a + p.x, 0) / poly.length, z: poly.reduce((a, p) => a + p.z, 0) / poly.length };
          write(pool.fan, fanPositions(poly, ORIGIN));
          write(pool.edgeA, bandPositions(poly, insetOf(poly, 0.08), ORIGIN));
          write(pool.shrink, bandPositions(poly, insetOf(poly, 0.05), warnCentre));
          place(warn.fan, 0.05);
          place(warn.edgeA, 0.052);
        } else {
          // Coil ring (M4 §4): fill between 4.75 and 7 m, both edges outlined; the shrink ring is the outer edge.
          warnCentre = zone.c;
          const outer = circle(zone.c, zone.outer), inner = circle(zone.c, zone.inner);
          write(pool.ring, bandPositions(outer, inner, ORIGIN));
          write(pool.edgeA, bandPositions(outer, circle(zone.c, zone.outer - 0.08), ORIGIN));
          write(pool.edgeB, bandPositions(circle(zone.c, zone.inner + 0.08), inner, ORIGIN));
          write(pool.shrink, bandPositions(outer, circle(zone.c, zone.outer - 0.05), warnCentre));
          place(warn.ring, 0.05);
          place(warn.edgeA, 0.052);
          place(warn.edgeB, 0.052);
        }
        warnUp = true;
      };

      // Phase-2 coil water wall (visual only, M4 §4) and the intro breach splash.
      const coilWallMat = copy(mat.wall);
      const coilWall = spawn(mesh.coilWall, [coilWallMat]);
      let coilWallAge = -1;
      let coilWallAt: V2 = { x: 0, z: 0 };
      const splash = spawn(mesh.joint, [copy(mat.wall)]);
      let splashAge = -1;
      let splashAt: V2 = { x: 0, z: 0 };

      const difficulty = () => tuning.current.difficulty;
      /** A new brain: knobs (dragon HP, attack gap) and labs apply at every fight start. */
      const makeBrain = (start: 'fight' | 'lurk', transitionSeen: boolean) => {
        const hpMax = Math.round(difficulty().dragonHp);
        const labs = session.frontend().lab.split(',');
        const opts = { hpMax, minGap: Math.round(difficulty().gapMin), start, transitionSeen };
        if (labs.includes('phase2')) return createBrain({ ...opts, hp: Math.ceil(hpMax / 2) + 1 });
        if (labs.includes('finish')) return createBrain({ ...opts, phase2: true, hp: 1 });
        if (labs.includes('bosslow')) return createBrain({ ...opts, phase2: true, hp: 40 });
        return createBrain(opts);
      };
      let brain = makeBrain('lurk', false);
      let prev = brain.points();
      let cur = prev;
      let acc = 0;
      let hold = 0;
      let queue: DragonEvent[] = [];
      let telegraphAt = 0;
      let lastZone: Zone | null = null;
      let lastHit: { kind: AttackKind; step: number; telegraphAt: number; zone: string } | null = null;
      const shake = new Map<number, number>();
      let cpuMs = 0;
      let eye = 0.3;
      let worldTime = 0;
      let lensHidden = 0;
      let seeThrough = 0;
      let engagedRule: (() => boolean) | undefined;

      const capsules = () => hurtCapsules(cur);
      const nezhaXZ = (): V2 => {
        const r = player.root();
        return { x: r[0], z: r[2] };
      };
      const engagedNow = () => {
        const n = nezhaXZ();
        return Math.hypot(n.x, n.z) <= ARENA.boundary + 0.5 && (engagedRule?.() ?? true);
      };

      world.addSystem(FixedUpdate, {
        name: 'nezha-dragon',
        after: ['nezha-clock'],
        before: ['nezha-combat'],
        queries: [],
        fn: () => {
          if (!session.playing()) return;
          const t0 = performance.now();
          // The fall plays on real steps (M4 §8: the victory slow motion is for Nezha and the water).
          const scale = brain.snapshot().mode === 'dead' ? (session.clock.frozen() ? 0 : 1) : session.clock.worldScale();
          worldTime += scale / 60;
          if (hold > 0) {
            // Bound by the sash: the dragon's own clock is zero (wave, whiskers, warnings, opening all stop).
            hold -= scale;
            cpuMs += (performance.now() - t0 - cpuMs) * 0.05;
            return;
          }
          acc += scale;
          while (acc >= 1) {
            acc -= 1;
            prev = cur;
            const events = brain.step({ nezha: nezhaXZ(), engaged: engagedNow() });
            cur = brain.points();
            for (const [seg, left] of shake) left <= 1 ? shake.delete(seg) : shake.set(seg, left - 1);
            for (const e of events) {
              if (e.type === 'telegraph') {
                showWarning(e.zone);
                telegraphAt = brain.snapshot().step;
                lastZone = e.zone;
              }
              if (e.type === 'hit') {
                lastHit = { kind: e.kind, step: brain.snapshot().step, telegraphAt, zone: e.zone.kind };
                clearWarning();
                if (e.kind === 'coil' && e.zone.kind === 'ring') {
                  coilWallAge = 0;
                  coilWallAt = e.zone.c;
                }
              }
              if (e.type === 'breach') {
                splashAge = 0;
                splashAt = e.at;
              }
              queue.push(e);
            }
          }
          cpuMs += (performance.now() - t0 - cpuMs) * 0.05;
        },
      }).unwrap();
      yield () => world.removeSystem(FixedUpdate, 'nezha-dragon').unwrap();

      world.addSystem(Update, {
        name: 'nezha-dragon-view',
        after: [FixedUpdate],
        before: [PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const t0 = performance.now();
          const dt = Math.min(world.getResource(Time).delta, 0.1);
          const a = hold > 0 ? 1 : Math.min(1, acc);
          const pts: P3[] = cur.map((p, i) => {
            const q = prev[i] ?? p;
            return [q[0] + (p[0] - q[0]) * a, q[1] + (p[1] - q[1]) * a, q[2] + (p[2] - q[2]) * a];
          });
          // Hit reaction: only the struck capsule jolts ±4° (≈ 0.12 m), back in 6 steps.
          for (const [seg, left] of shake) {
            const cap = hurtCapsules(pts)[seg]!;
            const amp = 0.13 * (left / 6) * Math.sin(left * 2.1);
            for (let i = cap.from; i <= cap.to; i += 1) pts[i]![1] += amp;
          }
          // Camera see-through: parts within 2 m of the lens, or between the lens and Nezha.
          const cam = readPresentationWorldMatrix(world, cameraEntity);
          const root = player.root();
          const chest: P3 = [root[0], FLOOR_Y + 1.6, root[2]];
          const cx = cam?.[12] ?? 0, cy = cam?.[13] ?? 0, cz = cam?.[14] ?? 0;
          const fadeOf = (p: P3, r: number) => {
            const near = Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) - r;
            const lx = chest[0] - cx, ly = chest[1] - cy, lz = chest[2] - cz;
            const len2 = lx * lx + ly * ly + lz * lz || 1;
            const t = ((p[0] - cx) * lx + (p[1] - cy) * ly + (p[2] - cz) * lz) / len2;
            const between = t > 0 && t < 1 && Math.hypot(p[0] - (cx + lx * t), p[1] - (cy + ly * t), p[2] - (cz + lz * t)) < r + 0.25;
            // Lens inside / touching the body: that part is not drawn at all (no full-screen tint).
            if (near < LENS_HIDE) return 4;
            return near < 2 || between ? 3 : 0;
          };
          let hiddenParts = 0;
          for (let i = 0; i < POINTS; i += 1) {
            const p = pts[i]!, r = radius(i);
            const j = joints[i]!;
            world.set(j.entity, Transform, { pos: p, scale: [r, r, r] }).unwrap();
            const raw = fadeOf(p, r);
            if (raw === 4) {
              hiddenParts += 1;
              world.set(j.entity, Transform, { scale: [0, 0, 0] }).unwrap();
            }
            const level = Math.min(3, raw);
            if (level !== j.level) {
              j.level = level;
              world.set(j.entity, MeshRenderer, { materials: [routeMats()[bandOf(i)]![level]!] } as never).unwrap();
            }
            if (i < POINTS - 1) {
              const q = pts[i + 1]!;
              const s = segs[i]!;
              const rr = (r + radius(i + 1)) / 2;
              world.set(s.entity, Transform, { pos: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], quat: segmentQuat(p, q), scale: [rr, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), rr] }).unwrap();
              const rawQ = fadeOf(q, radius(i + 1));
              if (raw === 4 || rawQ === 4) {
                hiddenParts += 1;
                world.set(s.entity, Transform, { scale: [0, 0, 0] }).unwrap();
              }
              const sl = Math.min(3, Math.max(level, rawQ));
              if (sl !== s.level) {
                s.level = sl;
                world.set(s.entity, MeshRenderer, { materials: [routeMats()[bandOf(i)]![sl]!] } as never).unwrap();
              }
            }
          }
          // Dorsal ridge fins along the back (#587A6D), keeping the tail readable against the vortex.
          const snapV = brain.snapshot();
          fins.forEach((fin, k) => {
            const i = 2 + k * 2;
            const p = pts[i]!, q = pts[i + 1]!;
            const r = radius(i);
            // Phase 2 (M4 §2): the fins rise ×1.4 one after another during the roar, neck to tail.
            const rise = snapV.roarK !== null ? smooth((snapV.roarK - (12 + (84 / 19) * k)) / 8) : snapV.phase === 2 ? 1 : 0;
            const h = Math.max(0.12, r * 0.55) * (1 + 0.4 * rise);
            world.set(fin, Transform, { pos: [p[0], p[1] + r + h * 0.4, p[2]], quat: lookQuat([q[0] - p[0], 0, q[2] - p[2]]), scale: [r * 0.5, h, r * 0.9] }).unwrap();
          });
          // Head: along the neck; in the opening it looks at Nezha.
          const snap = snapV;
          const p0 = pts[0]!, p1 = pts[1]!;
          let dir: P3 = [p0[0] - p1[0], p0[1] - p1[1], p0[2] - p1[2]];
          const atNezha: P3 = [root[0] - p0[0], FLOOR_Y + 2.6 - p0[1], root[2] - p0[2]];
          if (snap.opening) dir = atNezha;
          else if (snap.kind === 'coil') dir = [atNezha[0], atNezha[1] * 0.3, atNezha[2]];
          else if (snap.introK !== null && snap.introK >= INTRO.turnFrom) {
            // Intro (M4 §1): the head turns to face Nezha over 648–688 and holds her gaze.
            const w = smooth((snap.introK - INTRO.turnFrom) / (INTRO.turnTo - INTRO.turnFrom));
            const n0 = Math.hypot(...dir) || 1, n1 = Math.hypot(...atNezha) || 1;
            dir = [dir[0] / n0 + (atNezha[0] / n1 - dir[0] / n0) * w, dir[1] / n0 + (atNezha[1] / n1 - dir[1] / n0) * w, dir[2] / n0 + (atNezha[2] / n1 - dir[2] / n0) * w];
          }
          const hq = lookQuat(dir);
          world.set(head, Transform, { pos: p0, quat: hq, scale: [1, 1, 1] }).unwrap();
          world.set(eyes, Transform, { pos: p0, quat: hq, scale: [1, 1, 1] }).unwrap();
          // Eyes: 30 % steady, rise to 50 % in 6 steps on a telegraph, 15 % in the opening, close as it dies. Never flicker.
          // Phase 2 (M4 §2): the steady glow rises linearly 30 % → 45 % over the 120-step roar, never flickers.
          const base = snap.roarK !== null ? 0.3 + 0.15 * Math.min(1, snap.roarK / BRAIN.roarSteps) : snap.phase === 2 ? 0.45 : 0.3;
          let want = base;
          if (snap.telegraph && snap.k !== null) want = base + 0.2 * Math.min(1, snap.k / 6);
          else if (snap.opening) want = 0.15;
          if (snap.mode === 'dead') want = Math.max(0, base * (1 - snap.deathK / BRAIN.deathEyesClose));
          if (Math.abs(want - eye) > 1e-3) {
            eye = snap.telegraph || snap.mode === 'dead' || snap.roarK !== null ? want : eye + (want - eye) * Math.min(1, dt * 20);
            assets.update(eyeMat, { values: { intensity: eye } } as never).unwrap();
          }
          // Warning: flickering fill, cyan edge shrinking onto the outline exactly at the hit frame.
          // Only while a warning is up: on the hit step the warning is already cleared (k == hit still
          // reads as "telegraph"), and redrawing the shrink ring there left the last outline on the floor.
          if (warnUp && snap.telegraph && snap.hitStep !== null && snap.k !== null) {
            const k = Math.min(1, (snap.k + a) / snap.hitStep);
            const s = 1.5 - 0.5 * k;
            world.set(warn.shrink, Transform, { pos: [warnCentre.x, FLOOR_Y + 0.054, warnCentre.z], scale: [s, 1, s] }).unwrap();
            assets.update(fillMat, { values: { intensity: 0.6 + 0.3 * (0.5 + 0.5 * Math.sin(worldTime * Math.PI * 12)) } } as never).unwrap();
          }
          // Coil water burst: 0 → 3 m in 12 steps from the hit, holds, falls back (world clock).
          if (coilWallAge >= 0) {
            coilWallAge += dt * 60 * session.clock.worldScale();
            const h = coilWallAge < 12 ? 3 * smooth(coilWallAge / 12) : coilWallAge < 40 ? 3 : 3 * (1 - smooth((coilWallAge - 40) / 20));
            if (coilWallAge > 60) {
              coilWallAge = -1;
              world.set(coilWall, Transform, { pos: [0, -60, 0], scale: [0, 0, 0] }).unwrap();
            } else world.set(coilWall, Transform, { pos: [coilWallAt.x, FLOOR_Y, coilWallAt.z], scale: [5.9, Math.max(0.01, h), 5.9] }).unwrap();
          }
          // Intro breach: a flattened burst of water where the head comes through the wall.
          if (splashAge >= 0) {
            splashAge += dt * 60;
            const t = Math.min(1, splashAge / 30);
            if (t >= 1) {
              splashAge = -1;
              world.set(splash, Transform, { pos: [0, -60, 0], scale: [0, 0, 0] }).unwrap();
            } else world.set(splash, Transform, { pos: [splashAt.x, FLOOR_Y + 4.0, splashAt.z], scale: [1 + 4 * t, (1 + 4 * t) * 0.6 * (1 - t), 1 + 4 * t] }).unwrap();
          }
          lensHidden = hiddenParts;
          seeThrough = joints.filter((j) => j.level > 0).length;
          cpuMs += (performance.now() - t0 - cpuMs) * 0.05;
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-dragon-view').unwrap();

      const service: DragonService = {
        points: () => cur,
        strike: (x, z, facing, range, arcDeg) => {
          const fx = -Math.sin(facing), fz = -Math.cos(facing);
          // Roaring, lurking, in the intro or fallen: strikes pass through (hollow lock marker).
          const canHit = brain.vulnerable();
          let best: DragonStrike | undefined;
          let nearest = { distance: Infinity, angleDeg: 0, point: { x, z }, segment: -1, tail: false };
          for (const c of capsules()) {
            const p = closestOnSegment(c.a, c.b, x, z);
            const d = Math.max(0, Math.hypot(p.x - x, p.z - z) - c.r);
            const len = Math.hypot(p.x - x, p.z - z);
            const ang = len < 1e-6 ? 0 : (Math.acos(Math.max(-1, Math.min(1, ((p.x - x) * fx + (p.z - z) * fz) / len))) * 180) / Math.PI;
            if (d < nearest.distance) nearest = { distance: d, angleDeg: ang, point: p, segment: c.index, tail: c.tail };
            if (!canHit || c.bottom > HITTABLE_UNDERSIDE + 1e-9 || d > range + 1e-9 || ang > arcDeg + 1e-9) continue;
            if (!best || d < best.distance) best = { hit: true, distance: d, angleDeg: ang, point: p, segment: c.index, tail: c.tail };
          }
          return best ?? { hit: false, ...nearest };
        },
        frontDistance: (x, z) => {
          let d = Infinity;
          for (const c of capsules()) if (!c.tail) {
            const p = closestOnSegment(c.a, c.b, x, z);
            d = Math.min(d, Math.max(0, Math.hypot(p.x - x, p.z - z) - c.r));
          }
          return d;
        },
        lowDistance: (x, z) => {
          let d = Infinity;
          for (let i = 0; i < POINTS; i += 1) {
            const p = cur[i]!;
            if (p[1] - radius(i) > HURT_TOP) continue;
            d = Math.min(d, Math.max(0, Math.hypot(p[0] - x, p[2] - z) - radius(i)));
          }
          return d;
        },
        frontNearest: (x, z) => frontNearest(cur, x, z),
        pushOut: (x, z, margin) => {
          // The strike (hold end → hit frame) never shoves Nezha out of the warned sweep: damage is
          // settled on the hit frame against where she chose to be (M3 §5, single-frame settlement).
          const snap = brain.snapshot();
          if (snap.mode === 'attack' && snap.kind && snap.k !== null && snap.k > ATTACKS[snap.kind].hold && snap.k <= ATTACKS[snap.kind].hit) return { x, z };
          let px = x, pz = z;
          // Solid below the 3.5 m pass-over clearance (Nezha spans ≈ 1.15–3.1 m): a part is either a wall
          // or high enough to pass over her head — never in between.
          for (let i = 0; i < POINTS; i += 1) {
            const p = cur[i]!;
            if (p[1] - radius(i) >= BRAIN.overheadClear) continue;
            const dx = px - p[0], dz = pz - p[2];
            const d = Math.hypot(dx, dz);
            const want = radius(i) + margin;
            if (d < want && d > 1e-6) {
              px = p[0] + (dx / d) * want;
              pz = p[2] + (dz / d) * want;
            }
          }
          return { x: px, z: pz };
        },
        damage: (amount, segment) => {
          const result = brain.damage(amount);
          if (result === 'ignored') return result;
          shake.set(segment, 6);
          if (result === 'phase') {
            clearWarning();
            hold = 0;
            queue.push({ type: 'phase', steps: brain.snapshot().transitionLen });
          }
          if (result === 'dead') {
            clearWarning();
            queue.push({ type: 'dead' });
          }
          return result;
        },
        bind: (steps) => {
          hold = Math.max(hold, steps);
        },
        bound: () => hold > 0,
        opening: () => brain.snapshot().opening,
        alive: () => brain.snapshot().mode !== 'dead',
        hp: () => ({ hp: brain.snapshot().hp, max: brain.snapshot().hpMax }),
        phase: () => brain.snapshot().phase,
        vulnerable: () => brain.vulnerable(),
        beginIntro: () => brain.beginIntro(),
        skipIntroTo: (k) => {
          brain.skipIntroTo(k);
          prev = cur = brain.points();
        },
        calm: () => {
          brain.abort();
          hold = 0;
          clearWarning();
        },
        setEngagedRule: (rule) => {
          engagedRule = rule;
        },
        head: () => cur[0]!,
        engaged: engagedNow,
        drain: () => {
          const out = queue;
          queue = [];
          return out;
        },
        reset: (start, transitionSeen) => {
          brain = makeBrain(start, transitionSeen);
          prev = cur = brain.points();
          coilWallAge = -1;
          world.set(coilWall, Transform, { pos: [0, -60, 0], scale: [0, 0, 0] }).unwrap();
          acc = 0;
          hold = 0;
          queue = [];
          shake.clear();
          clearWarning();
        },
        vortexSpeed: () => {
          const s = brain.snapshot();
          return s.mode === 'dead' ? Math.max(0, 1 - s.deathK / BRAIN.deathEyesClose) : 1;
        },
      };

      yield telemetry.section('dragon', () => {
        const s = brain.snapshot();
        const caps = capsules();
        const root = player.root();
        let overhead = Infinity;
        for (let i = 0; i < POINTS; i += 1) {
          const p = cur[i]!;
          if (Math.hypot(p[0] - root[0], p[2] - root[2]) < radius(i) + 0.35) overhead = Math.min(overhead, p[1] - radius(i));
        }
        return {
          mode: s.mode,
          hp: s.hp,
          hpMax: s.hpMax,
          phase: s.phase,
          roarK: s.roarK,
          transitionLen: s.transitionLen,
          coilCd: s.coilCd,
          coilPending: s.coilPending,
          introK: s.introK,
          second: s.second,
          vulnerable: brain.vulnerable(),
          coilWall: coilWallAge >= 0 ? r3(coilWallAge) : null,
          kind: s.kind,
          k: s.k,
          hitStep: s.hitStep,
          telegraph: s.telegraph,
          opening: s.opening,
          forced: s.forced,
          since: s.since,
          intent: s.intent,
          repeat: s.repeat,
          bound: hold > 0,
          holdLeft: r3(Math.max(0, hold)),
          engaged: engagedNow(),
          eye: r3(eye),
          deathK: s.deathK,
          head: [r3(cur[0]![0]), r3(cur[0]![1]), r3(cur[0]![2])],
          headR: r3(Math.hypot(cur[0]![0], cur[0]![2])),
          /** Tail hurt zone sample (point 37) and its underside, for scripted tail-hit checks. */
          tail: [r3(cur[37]![0]), r3(cur[37]![1]), r3(cur[37]![2])],
          tailUnderside: r3(cur[37]![1] - radius(37)),
          frontDistance: r3(service.frontDistance(root[0], root[2])),
          minUnderside: r3(Math.min(...caps.map((c) => c.bottom))),
          frontUndersideMax: r3(Math.max(...caps.filter((c) => !c.tail).map((c) => c.bottom))),
          overheadUnderside: Number.isFinite(overhead) ? r3(overhead) : null,
          telegraphAt,
          polygon: lastZone?.kind === 'poly' ? lastZone.poly.map((p) => [r3(p.x), r3(p.z)]) : null,
          ring: lastZone?.kind === 'ring' ? { c: [r3(lastZone.c.x), r3(lastZone.c.z)], inner: lastZone.inner, outer: lastZone.outer } : null,
          nezhaZoneDistance: lastZone ? r3(zoneDistance(lastZone, root[0], root[2])) : null,
          lastHit,
          log: s.log.slice(-12),
          cpuMs: r3(cpuMs),
          seeThrough,
          lensHidden,
          hitSteps: { bite: ATTACKS.bite.hit, lash: ATTACKS.lash.hit, charge: ATTACKS.charge.hit, coil: ATTACKS.coil.hit },
          coilHeadY: s.kind === 'coil' ? r3(cur[0]![1]) : null,
          coilRadius: COIL.outer,
        };
      });
      void CAPSULE_CENTER_Y;
      void DEG;
      yield ctx.provide('nezhaDragon', service);
    }, 'nezha/dragon');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.dragonPlugin,
  build: () => ok({
    'plugin/dragon': { kind: 'plugin', module: { specifier: './dragon.pack.ts', export: 'dragon' } },
  }),
});
