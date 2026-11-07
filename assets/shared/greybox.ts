/**
 * Greybox wall segmentation derived from the layout. Used by the geometry Pack
 * (merged visual meshes), the scene Pack (one static collider per segment) and
 * placement code (seaweed along the canyon walls), so walls and colliders can
 * never drift apart.
 */
import { ARENA, CANYON, canyonCenterX, canyonHalfWidth, TRENCH } from './layout.ts';

export interface WallSegment {
  /** Segment centre on the floor. */
  readonly x: number;
  readonly z: number;
  /** Rotation around +Y so the box's local X runs along the wall. */
  readonly yaw: number;
  readonly length: number;
  /** Unit normal pointing into the walkable area. */
  readonly nx: number;
  readonly nz: number;
}

const DEG = Math.PI / 180;

/** Invisible boundary ring keeping Nezha's root within r = 19.5 m, open at the canyon mouth. */
export function boundarySegments(capsuleRadius = 0.35, thickness = 0.6): WallSegment[] {
  const out: WallSegment[] = [];
  const count = ARENA.boundarySegments;
  const step = (Math.PI * 2) / count;
  const r = ARENA.boundary + capsuleRadius + thickness / 2;
  const length = 2 * r * Math.sin(step / 2) + 0.1;
  for (let index = 0; index < count; index += 1) {
    const angle = (index + 0.5) * step; // 0 = +Z (canyon)
    const fromEntrance = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
    if (fromEntrance < ARENA.entranceHalfAngleDeg * DEG + step / 2) continue;
    out.push({ x: Math.sin(angle) * r, z: Math.cos(angle) * r, yaw: angle, length, nx: -Math.sin(angle), nz: -Math.cos(angle) });
  }
  return out;
}

/** Reef walls on both sides of the S-curved canyon, from the plaza edge to the dead end. */
export function canyonWallSegments(): WallSegment[] {
  const out: WallSegment[] = [];
  const start = CANYON.zStart + 0.4;
  const steps = Math.ceil((CANYON.zEnd - start) / CANYON.segmentLength);
  for (let index = 0; index < steps; index += 1) {
    const z0 = start + index * CANYON.segmentLength;
    const z1 = Math.min(CANYON.zEnd + 1, z0 + CANYON.segmentLength);
    for (const side of [-1, 1] as const) {
      const offset = (z: number) => canyonCenterX(z) + side * (canyonHalfWidth(z) + CANYON.wallThickness / 2);
      const x0 = offset(z0), x1 = offset(z1);
      const dx = x1 - x0, dz = z1 - z0;
      const length = Math.hypot(dx, dz);
      // Local X along (dx, dz): rotation by yaw maps (1,0,0) to (cos yaw, 0, -sin yaw).
      const yaw = Math.atan2(-dz, dx);
      const tx = dx / length, tz = dz / length;
      // Inward normal: perpendicular to the tangent, pointing toward the centre line.
      const nx = -side * tz, nz = side * tx;
      out.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, yaw, length, nx, nz });
    }
  }
  return out;
}

/** Far trench ring (远景) beyond the palace wall, open toward the canyon. */
export function trenchSegments(): WallSegment[] {
  const out: WallSegment[] = [];
  const step = (Math.PI * 2) / TRENCH.segments;
  const length = 2 * TRENCH.radius * Math.sin(step / 2);
  for (let index = 0; index < TRENCH.segments; index += 1) {
    const angle = (index + 0.5) * step;
    if (Math.cos(angle) > 0.9) continue; // the canyon leaves through here
    out.push({
      x: Math.sin(angle) * TRENCH.radius,
      z: Math.cos(angle) * TRENCH.radius,
      yaw: angle,
      length,
      nx: -Math.sin(angle),
      nz: -Math.cos(angle),
    });
  }
  return out;
}
