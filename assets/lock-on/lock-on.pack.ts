import { definePack } from '@forgeax/engine/pack/source';
import { FixedUpdate, Time, Update } from '@forgeax/engine/ecs';
import type { Plugin } from '@forgeax/engine/plugin';
import { PROPAGATE_TRANSFORMS_SYSTEM, readPresentationWorldMatrix } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import type { CameraService } from '../camera/camera.pack.ts';
import type { SessionService, TelemetryService, TuningService } from '../core/core.pack.ts';
import type { PlayerService } from '../hover-player/hover-player.pack.ts';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import { ARENA, FLOOR_Y } from '../shared/layout.ts';
import { HEAD_TOP_Y, NEZHA } from '../shared/nezha-shape.ts';
import type { DragonService, DragonStrike } from '../dragon/dragon.pack.ts';

type V3 = readonly [number, number, number];

/** The Dragon King as a combat target (M3). */
/**
 * Anything Nezha can lock onto and strike (v1.4.0 port: the boss and the 巡海夜叉 share one interface).
 * The boss registers itself here; mobs register / unregister as they spawn and die.
 */
export interface Foe {
  readonly id: string;
  readonly kind: 'boss' | 'mob';
  /** Lockable and strikable now (spawned, not dying). */
  readonly targetable: () => boolean;
  readonly surfaceDistance: (x: number, z: number) => number;
  /** Nearest body point from (x, z): the lock pivot (y = aim height above the floor). */
  readonly nearest: (x: number, z: number) => { readonly x: number; readonly z: number; readonly y: number };
  readonly strike: (x: number, z: number, facing: number, range: number, arcDeg: number) => DragonStrike;
  readonly damage: (amount: number, segment: number) => void;
  readonly touching: (x: number, z: number) => number;
  readonly pushOut: (x: number, z: number, margin: number) => { readonly x: number; readonly z: number };
  /** Points that frame it on screen (lock framing proof). */
  readonly framePoints: () => readonly V3[];
}

export interface TargetService {
  /** Add a foe (mobs as they spawn); returns its removal. */
  readonly register: (foe: Foe) => () => void;
  /** Id of the locked foe, if any. */
  readonly lockedId: () => string | undefined;
  /** Horizontal distance to the front 11 m surface (lock / sash range). */
  readonly surfaceDistance: (x: number, z: number) => number;
  readonly strike: (x: number, z: number, facing: number, range: number, arcDeg: number) => DragonStrike;
  /** A landed hit: damage the struck capsule. */
  readonly damage: (amount: number, segment: number) => void;
  /** Heavy lunge contact: horizontal distance to the nearest low body part. */
  readonly touching: (x: number, z: number) => number;
  /** Drop the lock (defeat / reset). */
  readonly release: () => void;
  /** Lock on now (M4: the intro hand-back and every retry start locked). */
  readonly lock: () => void;
  /** Yaw toward the nearest body point when within `range` and ±90° of facing, else undefined. */
  readonly autoTarget: (x: number, z: number, facing: number, range: number) => number | undefined;
  readonly locked: () => boolean;
  /** Yaw facing the body from (x, z). */
  readonly facingFrom: (x: number, z: number) => number;
  /** Contact distance used to stop the heavy lunge. */
  readonly contactGap: () => number;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    nezhaTarget: TargetService;
  }
}
const r3 = (value: number) => Math.round(value * 1000) / 1000;

/** Project a world point with the camera pose: normalised screen (0..1, top-left) and in-front flag. */
export function project(point: V3, pose: ReturnType<CameraService['pose']>, aspect: number) {
  const [qx, qy, qz, qw] = pose.rotation;
  const px = point[0] - pose.position[0], py = point[1] - pose.position[1], pz = point[2] - pose.position[2];
  // v' = conj(q) * v * q
  const ix = qw * px - qy * pz + qz * py;
  const iy = qw * py - qz * px + qx * pz;
  const iz = qw * pz - qx * py + qy * px;
  const iw = qx * px + qy * py + qz * pz;
  const vx = ix * qw + iw * qx + iy * qz - iz * qy;
  const vy = iy * qw + iw * qy + iz * qx - ix * qz;
  const vz = iz * qw + iw * qz + ix * qy - iy * qx;
  const t = Math.tan(pose.fov / 2);
  const depth = -vz;
  if (depth <= 1e-4) return { x: 0.5, y: 0.5, visible: false };
  return { x: 0.5 + (vx / depth / (t * aspect)) * 0.5, y: 0.5 - (vy / depth / t) * 0.5, visible: true };
}

function box(points: readonly { x: number; y: number; visible: boolean }[]) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  return { ...b, inFrame: points.every((p) => p.visible) && b.minX >= 0 && b.maxX <= 1 && b.minY >= 0 && b.maxY <= 1 };
}

/**
 * Lock-on (R) on the Dragon King: acquire within `lock.acquireRange` of the front 11 m surface.
 * Inside the boss field the lock never breaks by distance (the dragon may swim to the far band).
 * The lock point is the nearest point of the front 11 m centre line (smoothed 0.3 s, height 1.5–4 m);
 * A/D orbit it, W/S close / open, Nezha faces it, the camera frames both.
 */
export const lockOn: Plugin = {
  name: 'nezha/lock-on',
  provide: 'nezhaTarget',
  inject: ['world', 'gameHost', 'nezhaSession', 'nezhaTuning', 'nezhaTelemetry', 'nezhaPlayer', 'nezhaCamera', 'nezhaDragon'],
  apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    const session = ctx.nezhaSession as SessionService | undefined;
    const tuning = ctx.nezhaTuning as TuningService | undefined;
    const telemetry = ctx.nezhaTelemetry as TelemetryService | undefined;
    const player = ctx.nezhaPlayer as PlayerService | undefined;
    const camera = ctx.nezhaCamera as CameraService | undefined;
    const dragon = ctx.nezhaDragon as DragonService | undefined;
    if (!host || !session || !tuning || !telemetry || !player || !camera || !dragon) throw new Error('nezha/lock-on requires core, player, camera and dragon services');

    ctx.effect(function* () {
      let active = false;
      let orbitRadius = 0;
      let lastHint: string | undefined;
      let distance = Infinity;
      let look: [number, number, number] | undefined;
      let frame = { nezha: { minX: 0, maxX: 0, minY: 0, maxY: 0, inFrame: false }, target: { minX: 0, maxX: 0, minY: 0, maxY: 0, inFrame: false } };

      // --- Foes: the boss first, mobs as they register. `current` is the locked one.
      const boss: Foe = {
        id: 'boss',
        kind: 'boss',
        targetable: () => dragon.alive(),
        surfaceDistance: (x, z) => dragon.frontDistance(x, z),
        nearest: (x, z) => dragon.frontNearest(x, z),
        strike: (x, z, f, range, arc) => dragon.strike(x, z, f, range, arc),
        damage: (amount, segment) => { dragon.damage(amount, segment); },
        touching: (x, z) => dragon.lowDistance(x, z),
        pushOut: (x, z, m) => dragon.pushOut(x, z, m),
        framePoints: () => dragon.points().slice(0, 25).map((p) => [p[0], p[1], p[2]] as V3),
      };
      const foes: Foe[] = [boss];
      let current: Foe = boss;
      let struck: { foe: Foe; hit: DragonStrike }[] = [];
      const live = () => foes.filter((f) => f.targetable());
      const nearestFoe = (x: number, z: number, within: number, except?: Foe): Foe | undefined => {
        let best: Foe | undefined, bd = within;
        for (const f of live()) {
          if (f === except) continue;
          const d = f.surfaceDistance(x, z);
          if (d <= bd) { bd = d; best = f; }
        }
        return best;
      };
      const pivotOf = (x: number, z: number) => current.nearest(x, z);
      const lookPoint = (): V3 => look ?? [0, 2, 0];
      const margin = () => tuning.current.move.capsuleRadius + 0.05;
      const raise = (key: 'noTarget' | 'targetLost' | 'locked' | 'unlocked') => {
        lastHint = key;
        session.raiseHint(key);
      };
      const facingTo = (x: number, z: number) => {
        const p = pivotOf(x, z);
        return Math.atan2(-(p.x - x), -(p.z - z));
      };
      const engage = (on: boolean) => {
        active = on;
        if (on) {
          const root = player.root();
          const p = pivotOf(root[0], root[2]);
          orbitRadius = Math.hypot(root[0] - p.x, root[2] - p.z);
          player.setLock({
            velocity: (x, z, h, v, speed) => {
              // Orbit the nearest front point; W / S change the radius (never closer than minOrbitGap).
              const p = pivotOf(x, z);
              let rx = x - p.x, rz = z - p.z;
              const r = Math.hypot(rx, rz) || 1e-6;
              rx /= r;
              rz /= r;
              let hh = h, vv = v;
              const n = Math.hypot(hh, vv);
              if (n > 1) {
                hh /= n;
                vv /= n;
              }
              if (vv > 0 && current.surfaceDistance(x, z) <= tuning.current.lock.minOrbitGap) vv = 0;
              let vx = (rz * hh - rx * vv) * speed;
              let vz = (-rx * hh - rz * vv) * speed;
              if (vv === 0) {
                const correction = Math.max(-2, Math.min(2, (orbitRadius - r) * 4));
                vx += rx * correction;
                vz += rz * correction;
              } else orbitRadius = r;
              return { x: vx, z: vz };
            },
            facing: facingTo,
          });
          // Head above 5 m (bite rear-up): tilt the aim up by 0.6 m per metre, at most 1.5 m.
          camera.setLockView({ target: lookPoint, raise: () => (current === boss ? Math.min(1.5, Math.max(0, (dragon.points()[0]![1] - FLOOR_Y - 5) * 0.6)) : 0) });
        } else {
          player.setLock(undefined);
          camera.setLockView(undefined);
        }
      };
      // Nezha cannot hover through the low parts of the body.
      player.setObstacle((x, z) => {
        let p = { x, z };
        for (const f of foes) if (f.targetable() || f === boss) p = f.pushOut(p.x, p.z, margin());
        return p;
      });
      yield () => player.setObstacle(undefined);
      yield () => engage(false);

      world.addSystem(Update, {
        name: 'nezha-lock-on',
        after: [FixedUpdate],
        before: ['nezha-camera', PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const dt = Math.min(world.getResource(Time).delta, 0.1);
          const l = tuning.current.lock;
          const root = player.root();
          // The locked mob fell: hop to the nearest live foe in range, else drop the lock quietly.
          if (active && !current.targetable() && current !== boss) {
            const next = nearestFoe(root[0], root[2], tuning.current.lock.acquireRange);
            if (next) current = next;
            else engage(false);
          }
          distance = current.surfaceDistance(root[0], root[2]);
          const p = pivotOf(root[0], root[2]);
          const want: [number, number, number] = [p.x, FLOOR_Y + Math.min(4, Math.max(1.5, p.y)), p.z];
          const k = 1 - Math.exp(-dt / 0.1); // ≈ 0.3 s to settle
          look = look ? [look[0] + (want[0] - look[0]) * k, look[1] + (want[1] - look[1]) * k, look[2] + (want[2] - look[2]) * k] : want;
          if (!session.playing()) {
            if (session.phase() === 'title' && active) engage(false);
            return;
          }
          // The dragon fell: the lock drops quietly (the victory has its own shot, no hint).
          if (current === boss && !dragon.alive() && active) engage(false);
          if (player.input().lockPressed) {
            const pick = active ? undefined : nearestFoe(root[0], root[2], l.acquireRange);
            if (active) {
              engage(false);
              raise('unlocked');
            } else if (pick) {
              current = pick;
              distance = pick.surfaceDistance(root[0], root[2]);
              engage(true);
              raise('locked');
            } else raise('noTarget');
          }
          // Boss field: no automatic release by distance. Outside it the usual 30 m rule applies.
          const inField = current === boss && Math.hypot(root[0], root[2]) <= ARENA.wallRadius;
          if (active && !inField && distance > l.breakRange) {
            engage(false);
            raise('targetLost');
          }
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-lock-on').unwrap();

      // After the camera has moved: framing proof and the HUD marker.
      world.addSystem(Update, {
        name: 'nezha-lock-frame',
        after: ['nezha-camera'],
        before: ['nezha-core-publish'],
        queries: [],
        fn: () => {
          const pose = camera.pose();
          const size = host.drawingBufferSize?.();
          const aspect = size && size.height > 0 ? size.width / size.height : 16 / 9;
          const matrix = readPresentationWorldMatrix(world, player.entity);
          if (!matrix) return;
          const yaw = Math.atan2(-(matrix[2] ?? 0), matrix[0] ?? 1);
          const c = Math.cos(yaw), s = Math.sin(yaw);
          const model = FLOOR_Y + tuning.current.move.hoverHeight;
          const at = (lx: number, ly: number, lz: number): V3 => [(matrix[12] ?? 0) + lx * c + lz * s, model + ly, (matrix[14] ?? 0) - lx * s + lz * c];
          const tilt = (NEZHA.spearTiltDeg * Math.PI) / 180;
          const above = NEZHA.spearLength - NEZHA.spearBelowGrip;
          const nezhaPoints = [
            at(0, 0, 0), at(-0.25, 0.05, 0), at(0.25, 0.05, 0),
            at(-0.28, 1.3, 0), at(0.3, 1.3, 0), at(0, HEAD_TOP_Y, 0),
            at(NEZHA.grip[0], NEZHA.grip[1] + above * Math.cos(tilt), NEZHA.grip[2] - above * Math.sin(tilt)),
          ].map((p) => project(p, pose, aspect));
          const front = current.framePoints().map((p) => project(p, pose, aspect));
          frame = { nezha: box(nezhaPoints), target: box(front) };
          const marker = project(lookPoint(), pose, aspect);
          session.contribute({ lock: { active, marker, opening: active && current === boss && dragon.opening() } });
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-lock-frame').unwrap();

      yield ctx.provide('nezhaTarget', {
        register: (foe) => {
          foes.push(foe);
          return () => {
            const i = foes.indexOf(foe);
            if (i >= 0) foes.splice(i, 1);
            if (current === foe) {
              current = boss;
              if (active) engage(false);
            }
          };
        },
        lockedId: () => (active ? current.id : undefined),
        // Sash Bind reaches the boss only.
        surfaceDistance: (x, z) => dragon.frontDistance(x, z),
        // One swing hits every foe in its arc (v1.4.0 hitSet); the nearest decides the judge line.
        strike: (x, z, facing, range, arcDeg) => {
          struck = [];
          for (const f of live()) {
            const hit = f.strike(x, z, facing, range, arcDeg);
            if (hit.hit) struck.push({ foe: f, hit });
          }
          struck.sort((a, b) => a.hit.distance - b.hit.distance);
          return struck[0]?.hit ?? boss.strike(x, z, facing, range, arcDeg);
        },
        damage: (amount, segment) => {
          struck.forEach((s, i) => s.foe.damage(amount, i === 0 ? segment : s.hit.segment));
          struck = [];
        },
        touching: (x, z) => Math.min(...live().map((f) => f.touching(x, z)), Infinity),
        release: () => {
          if (active) engage(false);
        },
        lock: () => {
          if (!active && dragon.alive()) {
            current = boss;
            engage(true);
          }
        },
        autoTarget: (x, z, facing, range) => {
          let best: DragonStrike | undefined;
          for (const f of live()) {
            const hit = f.strike(x, z, facing, range, 90);
            if (hit.hit && (!best || hit.distance < best.distance)) best = hit;
          }
          if (!best) return undefined;
          return Math.atan2(-(best.point.x - x), -(best.point.z - z));
        },
        locked: () => active,
        facingFrom: facingTo,
        contactGap: () => margin() + 0.02,
      } satisfies TargetService);
      yield telemetry.section('lock', () => {
        const root = player.root();
        const p = pivotOf(root[0], root[2]);
        return {
          active,
          foe: active ? current.id : null,
          foes: live().map((f) => f.id),
          opening: active && current === boss && dragon.opening(),
          distance: r3(distance),
          hint: lastHint ?? null,
          orbitAngleDeg: r3((Math.atan2(root[0] - p.x, root[2] - p.z) * 180) / Math.PI),
          lookPoint: look ? look.map(r3) : null,
          nezhaInFrame: frame.nezha.inFrame,
          nezhaBox: Object.fromEntries(Object.entries(frame.nezha).map(([k, v]) => [k, typeof v === 'number' ? r3(v) : v])),
          targetBox: Object.fromEntries(Object.entries(frame.target).map(([k, v]) => [k, typeof v === 'number' ? r3(v) : v])),
        };
      });
    }, 'nezha/lock-on');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.lockOnPlugin,
  build: () => ok({
    'plugin/lock-on': { kind: 'plugin', module: { specifier: './lock-on.pack.ts', export: 'lockOn' } },
  }),
});
