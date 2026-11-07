/**
 * Build-time mesh composition: places factory primitives with a transform and
 * merges them into one multi-material MeshAsset (one submesh per slot). Pure and
 * deterministic so Pack builds cache correctly.
 */
import { createMeshBuilder } from '@forgeax/engine/geometry';
import type { AssetError, MeshAsset, MeshMaterialSlot, Result } from '@forgeax/engine/types';

export type V3 = readonly [number, number, number];
export type Q = readonly [number, number, number, number];

export function unwrap<T>(result: Result<T, AssetError>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

export const IDENTITY: Q = [0, 0, 0, 1];

export function axisAngle(axis: V3, angle: number): Q {
  const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angle / 2) / length;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

export function mulQ(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Euler rotation applied Y (yaw), then X (pitch), then Z (roll) in world terms: q = Y * X * Z. */
export function euler(x: number, y: number, z: number): Q {
  return mulQ(mulQ(axisAngle([0, 1, 0], y), axisAngle([1, 0, 0], x)), axisAngle([0, 0, 1], z));
}

export const yawQ = (angle: number): Q => axisAngle([0, 1, 0], angle);

export function rotate(q: Q, v: V3): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  const ix = qw * v[0] + qy * v[2] - qz * v[1];
  const iy = qw * v[1] + qz * v[0] - qx * v[2];
  const iz = qw * v[2] + qx * v[1] - qy * v[0];
  const iw = -qx * v[0] - qy * v[1] - qz * v[2];
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

/** Rotation taking unit vector `from` onto unit vector `to`. */
export function fromTo(from: V3, to: V3): Q {
  const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (dot < -0.999999) {
    const axis: V3 = Math.abs(from[0]) < 0.9 ? [0, -from[2], from[1]] : [from[2], 0, -from[0]];
    return axisAngle(axis, Math.PI);
  }
  const cross: V3 = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ];
  const w = 1 + dot;
  const length = Math.hypot(cross[0], cross[1], cross[2], w);
  return [cross[0] / length, cross[1] / length, cross[2] / length, w / length];
}

export interface Place {
  readonly t?: V3;
  readonly r?: Q;
  readonly s?: V3 | number;
}

interface Attributes {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly uv?: Float32Array;
}

function attributesOf(mesh: MeshAsset): Attributes {
  const position = mesh.attributes.position;
  const normal = mesh.attributes.normal;
  const uv = mesh.attributes.uv;
  if (!(position instanceof Float32Array) || !(normal instanceof Float32Array))
    throw new Error('MeshKit needs float position and normal attributes');
  return { position, normal, uv: uv instanceof Float32Array ? uv : undefined };
}

export class MeshKit {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly groups: number[][] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** Append a mesh (or a factory Result) scaled, rotated, then translated into this kit's slot. */
  add(source: MeshAsset | Result<MeshAsset, AssetError>, place: Place, slot: number): this {
    const mesh = 'kind' in source ? source : unwrap(source);
    const { position, normal, uv } = attributesOf(mesh);
    const scale: V3 = typeof place.s === 'number' ? [place.s, place.s, place.s] : (place.s ?? [1, 1, 1]);
    const rotation = place.r ?? IDENTITY;
    const translation = place.t ?? [0, 0, 0];
    const base = this.vertexCount;
    const count = position.length / 3;
    for (let index = 0; index < count; index += 1) {
      const p = rotate(rotation, [
        position[index * 3]! * scale[0],
        position[index * 3 + 1]! * scale[1],
        position[index * 3 + 2]! * scale[2],
      ]);
      this.positions.push(p[0] + translation[0], p[1] + translation[1], p[2] + translation[2]);
      const n = rotate(rotation, [
        normal[index * 3]! / scale[0],
        normal[index * 3 + 1]! / scale[1],
        normal[index * 3 + 2]! / scale[2],
      ]);
      const length = Math.hypot(n[0], n[1], n[2]) || 1;
      this.normals.push(n[0] / length, n[1] / length, n[2] / length);
      this.uvs.push(uv?.[index * 2] ?? 0, uv?.[index * 2 + 1] ?? 0);
    }
    const group = (this.groups[slot] ??= []);
    const flip = scale[0] * scale[1] * scale[2] < 0;
    const indices = mesh.indices;
    if (indices) {
      for (let index = 0; index < indices.length; index += 3) {
        const a = indices[index]!, b = indices[index + 1]!, c = indices[index + 2]!;
        if (flip) group.push(base + a, base + c, base + b);
        else group.push(base + a, base + b, base + c);
      }
    } else {
      for (let index = 0; index < count; index += 3) {
        if (flip) group.push(base + index, base + index + 2, base + index + 1);
        else group.push(base + index, base + index + 1, base + index + 2);
      }
    }
    return this;
  }

  /** Append raw triangles already in kit space. */
  addRaw(
    positions: readonly number[],
    normals: readonly number[],
    uvs: readonly number[],
    indices: readonly number[],
    slot: number,
  ): this {
    const base = this.vertexCount;
    this.positions.push(...positions);
    this.normals.push(...normals);
    this.uvs.push(...uvs);
    const group = (this.groups[slot] ??= []);
    for (const index of indices) group.push(base + index);
    return this;
  }

  build(slots: readonly MeshMaterialSlot[]): MeshAsset {
    const indices: number[] = [];
    const submeshes = [];
    for (let slot = 0; slot < slots.length; slot += 1) {
      const group = this.groups[slot] ?? [];
      if (group.length === 0) continue;
      submeshes.push({
        indexOffset: indices.length,
        indexCount: group.length,
        vertexCount: this.vertexCount,
        topology: 'triangle-list' as const,
        materialSlot: slot,
      });
      for (const index of group) indices.push(index);
    }
    if (this.groups.length > slots.length && this.groups.slice(slots.length).some((g) => g && g.length > 0))
      throw new Error('MeshKit used a material slot without a declaration');
    const builder = createMeshBuilder({
      attributes: {
        position: new Float32Array(this.positions),
        normal: new Float32Array(this.normals),
        uv: new Float32Array(this.uvs),
      },
      indices: new Uint32Array(indices),
      submeshes,
      materialSlots: slots,
    });
    return unwrap(builder.build());
  }
}

// --- Deterministic value noise for rocks, dunes and coral variation -------------------

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function noise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

export function fbm3(x: number, y: number, z: number, seed = 0, octaves = 4): number {
  let sum = 0, amplitude = 0.5, frequency = 1, total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += noise3(x * frequency, y * frequency, z * frequency, seed + octave * 17) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

/** Displace every vertex of `mesh` and rebuild smooth normals across duplicated seam vertices. */
export function displaceMesh(
  source: MeshAsset | Result<MeshAsset, AssetError>,
  displace: (p: V3, n: V3) => V3,
): MeshAsset {
  const mesh = 'kind' in source ? source : unwrap(source);
  const { position, normal, uv } = attributesOf(mesh);
  const count = position.length / 3;
  const out = new Float32Array(position.length);
  for (let index = 0; index < count; index += 1) {
    const p: V3 = [position[index * 3]!, position[index * 3 + 1]!, position[index * 3 + 2]!];
    const n: V3 = [normal[index * 3]!, normal[index * 3 + 1]!, normal[index * 3 + 2]!];
    const q = displace(p, n);
    out.set(q, index * 3);
  }
  const indices = mesh.indices ?? Uint32Array.from({ length: count }, (_, index) => index);
  const key = (index: number) =>
    `${Math.round(position[index * 3]! * 1e4)},${Math.round(position[index * 3 + 1]! * 1e4)},${Math.round(position[index * 3 + 2]! * 1e4)}`;
  const accum = new Map<string, [number, number, number]>();
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index]!, b = indices[index + 1]!, c = indices[index + 2]!;
    const ax = out[a * 3]!, ay = out[a * 3 + 1]!, az = out[a * 3 + 2]!;
    const e1 = [out[b * 3]! - ax, out[b * 3 + 1]! - ay, out[b * 3 + 2]! - az];
    const e2 = [out[c * 3]! - ax, out[c * 3 + 1]! - ay, out[c * 3 + 2]! - az];
    const fn: [number, number, number] = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    for (const vertex of [a, b, c]) {
      const k = key(vertex);
      const sum = accum.get(k) ?? [0, 0, 0];
      sum[0] += fn[0]; sum[1] += fn[1]; sum[2] += fn[2];
      accum.set(k, sum);
    }
  }
  const normals = new Float32Array(position.length);
  for (let index = 0; index < count; index += 1) {
    const sum = accum.get(key(index)) ?? [0, 1, 0];
    const length = Math.hypot(sum[0], sum[1], sum[2]) || 1;
    normals.set([sum[0] / length, sum[1] / length, sum[2] / length], index * 3);
  }
  const builder = createMeshBuilder({
    attributes: { position: out, normal: normals, uv: uv ?? new Float32Array(count * 2) },
    indices: new Uint32Array(indices),
    submeshes: [{ indexOffset: 0, indexCount: indices.length, vertexCount: count, topology: 'triangle-list', materialSlot: 0 }],
    materialSlots: [{ slotName: 'Surface' }],
  });
  return unwrap(builder.build());
}
