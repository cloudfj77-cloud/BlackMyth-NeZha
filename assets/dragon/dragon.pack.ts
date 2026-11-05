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
} from './body.ts';
import { BRAIN, createBrain, type DragonEvent } from './brain.ts';

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
  readonly damage: (amount: number, segment: number) => void;
  /** Sash Bind: the dragon's clock stops for `steps` (world-clock) steps. */
  readonly bind: (steps: number) => void;
  readonly bound: () => boolean;
  readonly opening: () => boolean;
  readonly alive: () => boolean;
  readonly hp: () => { readonly hp: number; readonly max: number };
  readonly engaged: () => boolean;
  /** Events since the last call (telegraph, hit, opening-end, dead, dead-done). */
  readonly drain: () => DragonEvent[];
  readonly reset: () => void;
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

/** Flat fan mesh of a convex polygon at y = 0 (warning fill). */
function polygonMesh(poly: Polygon, inset = 0, centre?: V2): MeshAsset {
  const c = centre ?? { x: poly.reduce((a, p) => a + p.x, 0) / poly.length, z: poly.reduce((a, p) => a + p.z, 0) / poly.length };
  const n = poly.length;
  const position: number[] = [], normal: number[] = [], uv: number[] = [], indices: number[] = [];
  if (inset <= 0) {
    position.push(c.x - (centre ? c.x : 0), 0, c.z - (centre ? c.z : 0));
    normal.push(0, 1, 0);
    uv.push(0, 0);
    for (const p of poly) {
      position.push(p.x - (centre ? c.x : 0), 0, p.z - (centre ? c.z : 0));
      normal.push(0, 1, 0);
      uv.push(p.x, p.z);
    }
    for (let i = 0; i < n; i += 1) indices.push(0, 1 + i, 1 + ((i + 1) % n));
  } else {
    // Band between the outline and an inset copy (vertex normals from the neighbouring edges).
    const inner = poly.map((p, i) => {
      const a = poly[(i - 1 + n) % n]!, b = poly[(i + 1) % n]!;
      const ex = b.x - a.x, ez = b.z - a.z;
      const len = Math.hypot(ex, ez) || 1;
      // CCW in (x, z): the inward normal of the tangent (ex, ez) is (-ez, ex).
      return { x: p.x - (ez / len) * inset, z: p.z + (ex / len) * inset };
    });
    for (const list of [poly, inner]) for (const p of list) {
      position.push(p.x - (centre ? c.x : 0), 0, p.z - (centre ? c.z : 0));
      normal.push(0, 1, 0);
      uv.push(p.x, p.z);
    }
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      indices.push(i, j, n + j, i, n + j, n + i);
    }
  }
  const built = createMeshBuilder({
    attributes: { position: new Float32Array(position), normal: new Float32Array(normal), uv: new Float32Array(uv) },
    indices: new Uint32Array(indices),
    submeshes: [{ indexOffset: 0, indexCount: indices.length, vertexCount: position.length / 3, topology: 'triangle-list', materialSlot: 0 }],
    materialSlots: [{ slotName: 'warning' }],
  }).build();
  if (!built.ok) throw built.error;
  return { ...built.value, aabb: new Float32Array([-40, -1, -40, 40, 1, 40]) };
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
    };
    const mat = {
      bands: [await load(guidText(materialGuid('dragon-front')), 'material'), await load(guidText(materialGuid('dragon-mid')), 'material'), await load(guidText(materialGuid('dragon-tail')), 'material')],
      ridge: await load(guidText(materialGuid('dragon-ridge')), 'material'),
      horn: await load(guidText(materialGuid('dragon-horn')), 'material'),
      eye: await load(guidText(materialGuid('dragon-eye')), 'material'),
      fade: await load(guidText(materialGuid('pillar-fade')), 'material'),
      fill: await load(guidText(materialGuid('warn-fill')), 'material'),
      edge: await load(guidText(materialGuid('warn-edge')), 'material'),
      shrink: await load(guidText(materialGuid('warn-shrink')), 'material'),
    };

    await ctx.effect(function* () {
      const copies: number[] = [];
      const spawned: EntityHandle[] = [];
      const meshes: number[] = [];
      yield () => {
        for (const e of spawned) world.despawn(e).unwrap();
        for (const c of copies) assets.release(c as never).unwrap();
        for (const m of meshes) assets.release(m as never).unwrap();
        for (const h of [...Object.values(mesh), mat.ridge, mat.horn, mat.eye, mat.fade, mat.fill, mat.edge, mat.shrink, ...mat.bands]) assets.release(h).unwrap();
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
      // Per band: solid material + three screen-door fade levels (shared by every segment of the band).
      const bandMats = mat.bands.map((solid, b) => [
        solid,
        ...FADES.slice(1).map((fade) => copy(mat.fade, { baseColor: [...BAND_COLORS[b]!, 1], rimColor: [BAND_COLORS[b]![0] * 1.4, BAND_COLORS[b]![1] * 1.4, BAND_COLORS[b]![2] * 1.4, 1], fade })),
      ]);
      const joints = Array.from({ length: POINTS }, (_, i) => ({ entity: spawn(mesh.joint, [bandMats[bandOf(i)]![0]!]), level: 0 }));
      const segs = Array.from({ length: POINTS - 1 }, (_, i) => ({ entity: spawn(mesh.segment, [bandMats[bandOf(i)]![0]!]), level: 0 }));
      const fins = Array.from({ length: 19 }, () => spawn(mesh.fin, [mat.ridge]));
      const head = spawn(mesh.head, [bandMats[0]![0]!, mat.horn, mat.ridge]);
      const eyeMat = copy(mat.eye);
      const eyes = spawn(mesh.eyes, [eyeMat]);
      // Warning entities (meshes are rebuilt per telegraph).
      const fillMat = copy(mat.fill);
      const shrinkMat = copy(mat.shrink);
      const warn = { fill: spawn(mesh.joint, [fillMat]), edge: spawn(mesh.joint, [mat.edge]), shrink: spawn(mesh.joint, [shrinkMat]) };
      let warnMeshes: number[] = [];
      const clearWarning = () => {
        for (const e of Object.values(warn)) world.set(e, Transform, { pos: [0, -60, 0], scale: [0, 0, 0] }).unwrap();
        for (const m of warnMeshes) assets.release(m as never).unwrap();
        warnMeshes = [];
      };
      yield clearWarning;
      let warnCentre: V2 = { x: 0, z: 0 };
      const showWarning = (poly: Polygon) => {
        clearWarning();
        warnCentre = { x: poly.reduce((a, p) => a + p.x, 0) / poly.length, z: poly.reduce((a, p) => a + p.z, 0) / poly.length };
        const fill = assets.create(polygonMesh(poly)).unwrap() as unknown as number;
        const edge = assets.create(polygonMesh(poly, 0.08)).unwrap() as unknown as number;
        const shrink = assets.create(polygonMesh(poly, 0.05, warnCentre)).unwrap() as unknown as number;
        warnMeshes = [fill, edge, shrink];
        world.set(warn.fill, MeshFilter, { assetHandle: fill } as never).unwrap();
        world.set(warn.edge, MeshFilter, { assetHandle: edge } as never).unwrap();
        world.set(warn.shrink, MeshFilter, { assetHandle: shrink } as never).unwrap();
        world.set(warn.fill, Transform, { pos: [0, FLOOR_Y + 0.05, 0], scale: [1, 1, 1] }).unwrap();
        world.set(warn.edge, Transform, { pos: [0, FLOOR_Y + 0.052, 0], scale: [1, 1, 1] }).unwrap();
      };

      let brain = createBrain();
      let prev = brain.points();
      let cur = prev;
      let acc = 0;
      let hold = 0;
      let queue: DragonEvent[] = [];
      let telegraphAt = 0;
      let lastPoly: Polygon | null = null;
      let lastHit: { kind: AttackKind; step: number; polygonVertices: number } | null = null;
      const shake = new Map<number, number>();
      let cpuMs = 0;
      let eye = 0.3;
      let worldTime = 0;

      const capsules = () => hurtCapsules(cur);
      const nezhaXZ = (): V2 => {
        const r = player.root();
        return { x: r[0], z: r[2] };
      };
      const engagedNow = () => {
        const n = nezhaXZ();
        return Math.hypot(n.x, n.z) <= ARENA.boundary + 0.5;
      };

      world.addSystem(FixedUpdate, {
        name: 'nezha-dragon',
        after: ['nezha-clock'],
        before: ['nezha-combat'],
        queries: [],
        fn: () => {
          if (!session.playing()) return;
          const t0 = performance.now();
          const scale = session.clock.worldScale();
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
                showWarning(e.polygon);
                telegraphAt = brain.snapshot().step;
                lastPoly = e.polygon;
              }
              if (e.type === 'hit') {
                lastHit = { kind: e.kind, step: brain.snapshot().step, polygonVertices: e.polygon.length };
                clearWarning();
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
            return near < 2 || between ? 3 : 0;
          };
          for (let i = 0; i < POINTS; i += 1) {
            const p = pts[i]!, r = radius(i);
            const j = joints[i]!;
            world.set(j.entity, Transform, { pos: p, scale: [r, r, r] }).unwrap();
            const level = fadeOf(p, r);
            if (level !== j.level) {
              j.level = level;
              world.set(j.entity, MeshRenderer, { materials: [bandMats[bandOf(i)]![level]!] } as never).unwrap();
            }
            if (i < POINTS - 1) {
              const q = pts[i + 1]!;
              const s = segs[i]!;
              const rr = (r + radius(i + 1)) / 2;
              world.set(s.entity, Transform, { pos: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], quat: segmentQuat(p, q), scale: [rr, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), rr] }).unwrap();
              const sl = Math.max(level, fadeOf(q, radius(i + 1)));
              if (sl !== s.level) {
                s.level = sl;
                world.set(s.entity, MeshRenderer, { materials: [bandMats[bandOf(i)]![sl]!] } as never).unwrap();
              }
            }
          }
          // Dorsal ridge fins along the back (#587A6D), keeping the tail readable against the vortex.
          fins.forEach((fin, k) => {
            const i = 2 + k * 2;
            const p = pts[i]!, q = pts[i + 1]!;
            const r = radius(i);
            const h = Math.max(0.12, r * 0.55);
            world.set(fin, Transform, { pos: [p[0], p[1] + r + h * 0.4, p[2]], quat: lookQuat([q[0] - p[0], 0, q[2] - p[2]]), scale: [r * 0.5, h, r * 0.9] }).unwrap();
          });
          // Head: along the neck; in the opening it looks at Nezha.
          const snap = brain.snapshot();
          const p0 = pts[0]!, p1 = pts[1]!;
          let dir: P3 = [p0[0] - p1[0], p0[1] - p1[1], p0[2] - p1[2]];
          if (snap.opening) dir = [root[0] - p0[0], FLOOR_Y + 2.6 - p0[1], root[2] - p0[2]];
          const hq = lookQuat(dir);
          world.set(head, Transform, { pos: p0, quat: hq, scale: [1, 1, 1] }).unwrap();
          world.set(eyes, Transform, { pos: p0, quat: hq, scale: [1, 1, 1] }).unwrap();
          // Eyes: 30 % steady, rise to 50 % in 6 steps on a telegraph, 15 % in the opening, close as it dies. Never flicker.
          let want = 0.3;
          if (snap.telegraph && snap.k !== null) want = 0.3 + 0.2 * Math.min(1, snap.k / 6);
          else if (snap.opening) want = 0.15;
          if (snap.mode === 'dead') want = Math.max(0, 0.3 * (1 - snap.deathK / BRAIN.deathEyesClose));
          if (Math.abs(want - eye) > 1e-3) {
            eye = snap.telegraph || snap.mode === 'dead' ? want : eye + (want - eye) * Math.min(1, dt * 20);
            assets.update(eyeMat, { values: { intensity: eye } } as never).unwrap();
          }
          // Warning: flickering fill, cyan edge shrinking onto the outline exactly at the hit frame.
          if (snap.telegraph && snap.hitStep !== null && snap.k !== null) {
            const k = Math.min(1, (snap.k + a) / snap.hitStep);
            const s = 1.5 - 0.5 * k;
            world.set(warn.shrink, Transform, { pos: [warnCentre.x, FLOOR_Y + 0.054, warnCentre.z], scale: [s, 1, s] }).unwrap();
            assets.update(fillMat, { values: { intensity: 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(worldTime * Math.PI * 12)) } } as never).unwrap();
          }
          cpuMs += (performance.now() - t0 - cpuMs) * 0.05;
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-dragon-view').unwrap();

      const service: DragonService = {
        points: () => cur,
        strike: (x, z, facing, range, arcDeg) => {
          const fx = -Math.sin(facing), fz = -Math.cos(facing);
          let best: DragonStrike | undefined;
          let nearest = { distance: Infinity, angleDeg: 0, point: { x, z }, segment: -1, tail: false };
          for (const c of capsules()) {
            const p = closestOnSegment(c.a, c.b, x, z);
            const d = Math.max(0, Math.hypot(p.x - x, p.z - z) - c.r);
            const len = Math.hypot(p.x - x, p.z - z);
            const ang = len < 1e-6 ? 0 : (Math.acos(Math.max(-1, Math.min(1, ((p.x - x) * fx + (p.z - z) * fz) / len))) * 180) / Math.PI;
            if (d < nearest.distance) nearest = { distance: d, angleDeg: ang, point: p, segment: c.index, tail: c.tail };
            if (c.bottom > HITTABLE_UNDERSIDE + 1e-9 || d > range + 1e-9 || ang > arcDeg + 1e-9) continue;
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
          let px = x, pz = z;
          for (let i = 0; i < POINTS; i += 1) {
            const p = cur[i]!;
            if (p[1] - radius(i) > HURT_TOP) continue;
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
          shake.set(segment, 6);
          if (brain.damage(amount)) queue.push({ type: 'dead' });
        },
        bind: (steps) => {
          hold = Math.max(hold, steps);
        },
        bound: () => hold > 0,
        opening: () => brain.snapshot().opening,
        alive: () => brain.snapshot().mode !== 'dead',
        hp: () => ({ hp: brain.snapshot().hp, max: BRAIN.hpMax }),
        engaged: engagedNow,
        drain: () => {
          const out = queue;
          queue = [];
          return out;
        },
        reset: () => {
          brain = createBrain();
          prev = cur = brain.points();
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
          hpMax: BRAIN.hpMax,
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
          frontDistance: r3(service.frontDistance(root[0], root[2])),
          minUnderside: r3(Math.min(...caps.map((c) => c.bottom))),
          frontUndersideMax: r3(Math.max(...caps.filter((c) => !c.tail).map((c) => c.bottom))),
          overheadUnderside: Number.isFinite(overhead) ? r3(overhead) : null,
          telegraphAt,
          polygon: lastPoly ? lastPoly.map((p) => [r3(p.x), r3(p.z)]) : null,
          lastHit,
          log: s.log.slice(-12),
          cpuMs: r3(cpuMs),
          hitSteps: { bite: ATTACKS.bite.hit, lash: ATTACKS.lash.hit, charge: ATTACKS.charge.hit },
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
