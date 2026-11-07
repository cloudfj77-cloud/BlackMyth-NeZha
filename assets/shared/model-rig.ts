/**
 * Asset-track models in the game (11-06 22:24): mount an imported glb scene, find its bones by name,
 * drive bone chains from world-space points, and bake CPU-skinned afterimages into one shared mesh.
 */
import type { EntityHandle, World } from '@forgeax/engine/ecs';
import { createMeshBuilder } from '@forgeax/engine/geometry';
import { MeshFilter, MeshRenderer } from '@forgeax/engine/render';
import { ChildOf, Name, readPresentationWorldMatrix, Transform } from '@forgeax/engine/scene';
import { Skin } from '@forgeax/engine/skinning';
import type { MeshAsset } from '@forgeax/engine/types';

export type Q = [number, number, number, number];
export type V3 = [number, number, number];

// --- Quaternions ---------------------------------------------------------------------------
export const qMul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qInv = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
export const qAxis = (axis: V3, angle: number): Q => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
/** Rotation whose columns are the orthonormal axes x, y, z. */
export function qBasis(x: V3, y: V3, z: V3): Q {
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Frame with +Y along `y` and +Z as close to `up` as possible. */
export function qFrameY(y: V3, up: V3 = [0, 1, 0]): Q {
  const Y = norm(y);
  let X = cross(Y, up);
  if (Math.hypot(...X) < 1e-4) X = cross(Y, [1, 0, 0]);
  X = norm(X);
  const Z = cross(X, Y);
  return qBasis(X, Y, Z);
}
/** Frame with +Z along `z` (forward) and +Y as close to up as possible. */
export function qFrameZ(z: V3, up: V3 = [0, 1, 0]): Q {
  const Z = norm(z);
  let X = cross(up, Z);
  if (Math.hypot(...X) < 1e-4) X = [1, 0, 0];
  X = norm(X);
  const Y = cross(Z, X);
  return qBasis(X, Y, Z);
}
/** Rotation part of a column-major world matrix (scale removed). */
export function qOfMatrix(m: ArrayLike<number>): Q {
  const x = norm([m[0]!, m[1]!, m[2]!]), y = norm([m[4]!, m[5]!, m[6]!]), z = norm([m[8]!, m[9]!, m[10]!]);
  return qBasis(x, y, z);
}

// --- Building a model ------------------------------------------------------------------------
export interface ModelNodeSpec { readonly name: string; readonly parent: string | null; readonly t: readonly number[]; readonly r: readonly number[]; readonly s: readonly number[]; readonly mesh: string | null }

export interface MountedModel {
  readonly root: EntityHandle;
  readonly bone: (name: string) => EntityHandle;
  readonly has: (name: string) => boolean;
  /** Mesh assets read back (for afterimages), by glb mesh name. */
  readonly meshData: ReadonlyMap<string, MeshAsset>;
}

/**
 * Build an asset-track model from its glb node list (no glb materials are loaded — the importer's
 * Standard roots clash with ours, `material-artifact-conflict`): one entity per node, the skinned
 * mesh bound with an explicit `Skin.joints` list, rigid meshes on their nodes, our own materials.
 */
export async function buildModel(world: World, assets: unknown, spec: {
  readonly nodes: readonly ModelNodeSpec[];
  readonly skinMesh: string;
  readonly skinJoints: readonly string[];
  readonly skeletonGuid: string;
  readonly meshGuids: Readonly<Record<string, string>>;
  readonly materials: Readonly<Record<string, readonly unknown[]>>;
  readonly parent: EntityHandle | undefined;
  readonly local: { pos?: V3; quat?: Q; scale?: V3 };
}): Promise<{ model: MountedModel; dispose: () => void }> {
  const a = assets as { load: (g: string, k: string) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>; read: (h: never) => { unwrap: () => unknown }; release: (h: never) => { unwrap: () => void } };
  const handles: unknown[] = [];
  const get = async (guid: string, kind: string) => {
    const r = await a.load(guid, kind);
    if (!r.ok) throw r.error;
    handles.push(r.value);
    return r.value;
  };
  const skeleton = await get(spec.skeletonGuid, 'skeleton');
  const meshHandles = new Map<string, unknown>();
  const meshData = new Map<string, MeshAsset>();
  for (const [name, guid] of Object.entries(spec.meshGuids)) {
    const h = await get(guid, 'mesh');
    meshHandles.set(name, h);
    meshData.set(name, a.read(h as never).unwrap() as MeshAsset);
  }
  const root = world.spawn(
    { component: Transform, data: { pos: spec.local.pos ?? [0, 0, 0], quat: spec.local.quat ?? [0, 0, 0, 1], scale: spec.local.scale ?? [1, 1, 1] } },
    ...(spec.parent !== undefined ? [{ component: ChildOf, data: { parent: spec.parent } }] : []),
  ).unwrap();
  const byName = new Map<string, EntityHandle>();
  const spawned: EntityHandle[] = [];
  for (const n of spec.nodes) {
    const e = world.spawn(
      { component: Name, data: { value: n.name } },
      { component: Transform, data: { pos: [...n.t], quat: [...n.r], scale: [...n.s] } },
      { component: ChildOf, data: { parent: n.parent ? byName.get(n.parent)! : root } },
    ).unwrap();
    byName.set(n.name, e);
    spawned.push(e);
  }
  for (const n of spec.nodes) {
    if (!n.mesh) continue;
    const e = byName.get(n.name)!;
    world.addComponent(e, { component: MeshFilter, data: { assetHandle: meshHandles.get(n.mesh) } } as never);
    const mats = spec.materials[n.mesh] ?? [];
    const subs = Math.max(1, meshData.get(n.mesh)!.materialSlots.length);
    world.addComponent(e, { component: MeshRenderer, data: { materials: Array.from({ length: subs }, (_, k) => mats[Math.min(k, mats.length - 1)]) } } as never);
    if (n.mesh === spec.skinMesh) world.addComponent(e, { component: Skin, data: { skeleton: skeleton, joints: spec.skinJoints.map((j) => byName.get(j)!) } } as never);
  }
  return {
    model: {
      root,
      meshData,
      has: (name) => byName.has(name),
      bone: (name) => {
        const e = byName.get(name);
        if (e === undefined) throw new Error(`model bone missing: ${name}`);
        return e;
      },
    },
    dispose: () => {
      for (const e of [...spawned].reverse()) world.despawn(e);
      world.despawn(root);
      for (const h of handles) a.release(h as never).unwrap();
    },
  };
}

// --- Afterimages -------------------------------------------------------------------------------
export type GhostSource =
  | { readonly kind: 'skinned'; readonly mesh: MeshAsset; readonly joints: readonly EntityHandle[]; readonly ibm: Float32Array }
  | { readonly kind: 'rigid'; readonly mesh: MeshAsset; readonly entity: EntityHandle };

/**
 * Afterimages in ONE mesh (one draw): `slots` copies of all sources, each baked at a moment's pose
 * (CPU skinning for the skinned body). uv0.x = fade (1 → 0), uv0.y = strength (pale walk / dark action).
 */
export class GhostCloud {
  readonly entity: EntityHandle;
  private readonly verts: number;
  private readonly pos: Float32Array;
  private readonly nor: Float32Array;
  private readonly uv: Float32Array;
  private readonly life: { left: number; total: number }[];
  private live = false;
  private readonly palette: Float32Array;
  constructor(private readonly world: World, private readonly assets: { create: (m: MeshAsset) => { unwrap: () => unknown }; writeRange: (h: never, r: unknown) => { unwrap: () => void } }, private readonly sources: readonly GhostSource[], readonly slots: number, material: unknown) {
    let verts = 0;
    const idx: number[] = [];
    for (const s of sources) {
      const src = s.mesh.indices as Uint32Array | Uint16Array | undefined;
      for (const sm of s.mesh.submeshes) for (let k = 0; k < sm.indexCount; k += 1) idx.push((src?.[sm.indexOffset + k] ?? 0) + verts);
      verts += (s.mesh.attributes.position as Float32Array).length / 3;
    }
    this.verts = verts;
    const all = new Uint32Array(idx.length * slots);
    for (let sl = 0; sl < slots; sl += 1) for (let k = 0; k < idx.length; k += 1) all[sl * idx.length + k] = idx[k]! + sl * verts;
    this.pos = new Float32Array(verts * 3 * slots);
    for (let v = 1; v < this.pos.length; v += 3) this.pos[v] = -60;
    this.nor = new Float32Array(this.pos.length);
    this.uv = new Float32Array(verts * 2 * slots);
    const built = createMeshBuilder({
      attributes: { position: this.pos, normal: this.nor, uv: this.uv },
      indices: all,
      submeshes: [{ indexOffset: 0, indexCount: all.length, vertexCount: verts * slots, topology: 'triangle-list', materialSlot: 0 }],
      materialSlots: [{ slotName: 'ghosts' }],
    }).build();
    if (!built.ok) throw built.error;
    this.handle = assets.create({ ...built.value, aabb: new Float32Array([-80, -20, -80, 80, 40, 80]) }).unwrap();
    this.entity = world.spawn(
      { component: Transform, data: { pos: [0, 0, 0] } },
      { component: MeshFilter, data: { assetHandle: this.handle } as never },
      { component: MeshRenderer, data: { materials: [material] } as never },
    ).unwrap();
    this.life = Array.from({ length: slots }, () => ({ left: 0, total: 1 }));
    const maxJ = Math.max(1, ...sources.map((s) => (s.kind === 'skinned' ? s.joints.length : 0)));
    this.palette = new Float32Array(maxJ * 16);
  }
  readonly handle: unknown;

  private bake(slot: number): void {
    let base = slot * this.verts;
    for (const s of this.sources) {
      const P = s.mesh.attributes.position as Float32Array;
      const N = s.mesh.attributes.normal as Float32Array;
      const n = P.length / 3;
      if (s.kind === 'rigid') {
        const m = readPresentationWorldMatrix(this.world, s.entity);
        for (let v = 0; v < n; v += 1) {
          const x = P[v * 3]!, y = P[v * 3 + 1]!, z = P[v * 3 + 2]!, o = (base + v) * 3;
          if (!m) { this.pos[o + 1] = -60; continue; }
          this.pos[o] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
          this.pos[o + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
          this.pos[o + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
          const a = N[v * 3]!, b = N[v * 3 + 1]!, c = N[v * 3 + 2]!;
          this.nor[o] = m[0]! * a + m[4]! * b + m[8]! * c;
          this.nor[o + 1] = m[1]! * a + m[5]! * b + m[9]! * c;
          this.nor[o + 2] = m[2]! * a + m[6]! * b + m[10]! * c;
        }
      } else {
        // Palette = joint world × inverse bind (column-major 4×4).
        const pal = this.palette;
        s.joints.forEach((e, j) => {
          const w = readPresentationWorldMatrix(this.world, e);
          const b = s.ibm.subarray(j * 16, j * 16 + 16);
          for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
            let sum = 0;
            for (let k = 0; k < 4; k += 1) sum += (w ? w[k * 4 + r]! : (k === r ? 1 : 0)) * b[c * 4 + k]!;
            pal[j * 16 + c * 4 + r] = sum;
          }
        });
        const J = s.mesh.attributes.skinIndex as unknown as ArrayLike<number>;
        const W = s.mesh.attributes.skinWeight as unknown as ArrayLike<number>;
        for (let v = 0; v < n; v += 1) {
          const x = P[v * 3]!, y = P[v * 3 + 1]!, z = P[v * 3 + 2]!;
          const a = N[v * 3]!, b = N[v * 3 + 1]!, c = N[v * 3 + 2]!;
          let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
          for (let k = 0; k < 4; k += 1) {
            const w = W[v * 4 + k]!;
            if (w <= 0) continue;
            const m = J[v * 4 + k]! * 16;
            px += w * (pal[m]! * x + pal[m + 4]! * y + pal[m + 8]! * z + pal[m + 12]!);
            py += w * (pal[m + 1]! * x + pal[m + 5]! * y + pal[m + 9]! * z + pal[m + 13]!);
            pz += w * (pal[m + 2]! * x + pal[m + 6]! * y + pal[m + 10]! * z + pal[m + 14]!);
            nx += w * (pal[m]! * a + pal[m + 4]! * b + pal[m + 8]! * c);
            ny += w * (pal[m + 1]! * a + pal[m + 5]! * b + pal[m + 9]! * c);
            nz += w * (pal[m + 2]! * a + pal[m + 6]! * b + pal[m + 10]! * c);
          }
          const o = (base + v) * 3;
          this.pos[o] = px; this.pos[o + 1] = py; this.pos[o + 2] = pz;
          this.nor[o] = nx; this.nor[o + 1] = ny; this.nor[o + 2] = nz;
        }
      }
      base += n;
    }
    const o = slot * this.verts * 3;
    this.assets.writeRange(this.handle as never, { attribute: 'position', first: slot * this.verts, values: this.pos.subarray(o, o + this.verts * 3) }).unwrap();
    this.assets.writeRange(this.handle as never, { attribute: 'normal', first: slot * this.verts, values: this.nor.subarray(o, o + this.verts * 3) }).unwrap();
  }

  /** Start an afterimage in the freest slot: `life` steps, `strength` 0..1. */
  spawn(life: number, strength: number): void {
    let best = 0;
    for (let s = 1; s < this.slots; s += 1) if (this.life[s]!.left < this.life[best]!.left) best = s;
    this.bake(best);
    this.life[best] = { left: life, total: life };
    const o = best * this.verts * 2;
    for (let v = 0; v < this.verts; v += 1) this.uv[o + v * 2 + 1] = strength;
  }

  /** One step: fade every live slot (bright most of its life, then out). */
  step(): void {
    let any = false;
    this.life.forEach((l, s) => {
      if (l.left <= 0) return;
      l.left -= 1;
      any = true;
      const k = l.left / Math.max(1, l.total);
      const f = k > 0.5 ? 1 : (k / 0.5) ** 1.5;
      const o = s * this.verts * 2;
      for (let v = 0; v < this.verts; v += 1) this.uv[o + v * 2] = f;
    });
    if (any || this.live) this.assets.writeRange(this.handle as never, { attribute: 'uv', first: 0, values: this.uv }).unwrap();
    this.live = any;
  }

  clear(): void {
    for (const l of this.life) l.left = 0;
    this.uv.fill(0);
    this.assets.writeRange(this.handle as never, { attribute: 'uv', first: 0, values: this.uv }).unwrap();
  }
}
