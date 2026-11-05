/**
 * Long lock-target geometry (pure; tested). The placeholder is a box whose long
 * axis is local X (length L), height H, thickness T. Lock distances and orbiting
 * use the horizontal footprint, measured from the body surface, so a 20 m body
 * behaves like the serpentine dragon it stands in for.
 */
export interface TargetShape {
  readonly cx: number;
  readonly cz: number;
  readonly yaw: number;
  readonly length: number;
  readonly thickness: number;
  readonly height: number;
}

const local = (shape: TargetShape, x: number, z: number) => {
  const dx = x - shape.cx, dz = z - shape.cz;
  const c = Math.cos(shape.yaw), s = Math.sin(shape.yaw);
  return { u: dx * c - dz * s, w: dx * s + dz * c };
};
const world = (shape: TargetShape, u: number, w: number) => {
  const c = Math.cos(shape.yaw), s = Math.sin(shape.yaw);
  return { x: shape.cx + u * c + w * s, z: shape.cz - u * s + w * c };
};

/** Nearest point on the body's long axis (the orbit pivot and the camera's look point). */
export function axisPoint(shape: TargetShape, x: number, z: number): { readonly x: number; readonly z: number } {
  const { u } = local(shape, x, z);
  return world(shape, Math.max(-shape.length / 2, Math.min(shape.length / 2, u)), 0);
}

/** Horizontal distance from (x, z) to the body surface (0 inside). */
export function surfaceDistance(shape: TargetShape, x: number, z: number): number {
  const { u, w } = local(shape, x, z);
  const du = Math.max(0, Math.abs(u) - shape.length / 2);
  const dw = Math.max(0, Math.abs(w) - shape.thickness / 2);
  return Math.hypot(du, dw);
}

/** Push (x, z) out of the footprint grown by `margin`. */
export function keepOutside(shape: TargetShape, x: number, z: number, margin: number): { readonly x: number; readonly z: number } {
  const { u, w } = local(shape, x, z);
  const hu = shape.length / 2 + margin, hw = shape.thickness / 2 + margin;
  if (Math.abs(u) >= hu || Math.abs(w) >= hw) {
    // Outside the grown box; round the corners using the true distance to the body.
    const du = Math.max(0, Math.abs(u) - shape.length / 2), dw = Math.max(0, Math.abs(w) - shape.thickness / 2);
    const d = Math.hypot(du, dw);
    if (d >= margin || d === 0) return { x, z };
    const k = margin / d;
    return world(shape, Math.sign(u) * (shape.length / 2 + du * k), Math.sign(w) * (shape.thickness / 2 + dw * k));
  }
  // Inside: exit through the nearest side.
  if (hu - Math.abs(u) < hw - Math.abs(w)) return world(shape, Math.sign(u || 1) * hu, w);
  return world(shape, u, Math.sign(w || 1) * hw);
}

/**
 * Locked stick -> velocity. A/D orbit around the nearest axis point (so the path
 * follows the body like a stadium), W/S close or open the distance. `radius` is the
 * orbit radius to hold while only strafing (prevents outward drift).
 */
export function lockedVelocity(shape: TargetShape, x: number, z: number, horizontal: number, vertical: number, speed: number, radius: number, minGap: number) {
  const pivot = axisPoint(shape, x, z);
  let rx = x - pivot.x, rz = z - pivot.z;
  const r = Math.hypot(rx, rz) || 1e-6;
  rx /= r;
  rz /= r;
  let h = horizontal, v = vertical;
  const n = Math.hypot(h, v);
  if (n > 1) {
    h /= n;
    v /= n;
  }
  if (v > 0 && surfaceDistance(shape, x, z) <= minGap) v = 0;
  // Facing the pivot: forward f = -radial; player-right = (-fz, fx) = (rz, -rx).
  let vx = (rz * h - rx * v) * speed;
  let vz = (-rx * h - rz * v) * speed;
  if (v === 0) {
    const correction = Math.max(-2, Math.min(2, (radius - r) * 4));
    vx += rx * correction;
    vz += rz * correction;
  }
  return { x: vx, z: vz };
}

/** Facing yaw (Transform convention: forward -Z) toward the nearest axis point. */
export function facingPivot(shape: TargetShape, x: number, z: number): number {
  const pivot = axisPoint(shape, x, z);
  return Math.atan2(-(pivot.x - x), -(pivot.z - z));
}
