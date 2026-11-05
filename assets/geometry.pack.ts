import { createBoxGeometry, createConeGeometry, createCylinderGeometry, createMeshBuilder, createPlaneGeometry, createSphereGeometry, createTorusGeometry } from '@forgeax/engine/geometry';
import { definePack } from '@forgeax/engine/pack/source';
import type { MeshAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS, slot } from './shared/asset-refs.ts';
import {
  ARENA,
  BEAM,
  CANYON,
  canyonCenterX,
  canyonHalfWidth,
  PILLARS,
  seeded,
  TRENCH,
  WARN,
} from './shared/layout.ts';
import { axisAngle, fromTo, MeshKit, yawQ, type V3 } from './shared/mesh-kit.ts';
import { canyonWallSegments, trenchSegments } from './shared/greybox.ts';


const single = (mesh: MeshAsset, material: string): MeshAsset => ({ ...mesh, materialSlots: [slot('Surface', material)] });

function unwrapMesh(result: ReturnType<typeof createBoxGeometry>): MeshAsset {
  if (!result.ok) throw result.error;
  return result.value;
}

/** All reef walls merged into one mesh (one draw per material); colliders are separate entities. */
function walls(): MeshAsset {
  const kit = new MeshKit();
  // Reef canyon walls (rough rock: segments jittered in height and depth).
  const random = seeded(17);
  for (const segment of canyonWallSegments()) {
    // Visual rock never protrudes past the collider face: extra thickness grows outward only.
    const height = CANYON.wallHeight * (0.85 + random() * 0.3);
    const extra = random() * 1.2;
    kit.add(createBoxGeometry(segment.length + 0.6, height, CANYON.wallThickness + extra), {
      t: [segment.x - segment.nx * extra / 2, height / 2, segment.z - segment.nz * extra / 2],
      r: yawQ(segment.yaw),
    }, 1);
    // A recessed ledge band so the reef reads as layered rock, not a corridor.
    kit.add(createBoxGeometry(segment.length + 0.6, 0.5, 0.5), {
      t: [segment.x + segment.nx * (CANYON.wallThickness / 2 - 0.2), height * (0.35 + random() * 0.3), segment.z + segment.nz * (CANYON.wallThickness / 2 - 0.2)],
      r: yawQ(segment.yaw),
    }, 1);
  }
  // Dead end of the canyon.
  const endX = canyonCenterX(CANYON.zEnd);
  kit.add(createBoxGeometry(canyonHalfWidth(CANYON.zEnd) * 2 + 6, CANYON.wallHeight, 2.4), {
    t: [endX, CANYON.wallHeight / 2, CANYON.zEnd + 1.2],
  }, 1);
  return kit.build([slot('Palace Wall', 'palace-wall'), slot('Reef', 'reef-rock'), slot('Roof', 'palace-roof')]);
}

/** Far trench cliffs and terraces (远景): no collision, beyond the palace wall. */
function trench(): MeshAsset {
  const kit = new MeshKit();
  for (const segment of trenchSegments()) {
    kit.add(createBoxGeometry(segment.length + 1, TRENCH.cliffHeight, 4), {
      t: [segment.x * 1.12, TRENCH.cliffHeight / 2, segment.z * 1.12],
      r: yawQ(segment.yaw),
    }, 0);
    kit.add(createBoxGeometry(segment.length + 1, TRENCH.terraceY, 6), {
      t: [segment.x, TRENCH.terraceY / 2, segment.z],
      r: yawQ(segment.yaw),
    }, 0);
  }
  return kit.build([slot('Trench', 'trench-rock')]);
}

function pillar(radius: number, height: number): MeshAsset {
  const kit = new MeshKit();
  kit.add(createCylinderGeometry(radius, radius, height, 20, 1), { t: [0, 0, 0] }, 0);
  // Base and capital rings keep the "dragon pillar" read in greybox.
  kit.add(createCylinderGeometry(radius * 1.35, radius * 1.45, 0.5, 20, 1), { t: [0, -height / 2 + 0.25, 0] }, 0);
  kit.add(createCylinderGeometry(radius * 1.4, radius * 1.25, 0.6, 20, 1), { t: [0, height / 2 - 0.3, 0] }, 0);
  return kit.build([slot('Stone', 'pillar')]);
}

/** Frustum shaft for god rays: local y 0..1, bottom radius 1, top radius 0.4, open ended. */
function beamShaft(): MeshAsset {
  const kit = new MeshKit();
  kit.add(createCylinderGeometry(BEAM.topRadius / BEAM.bottomRadius, 1, 1, 32, 6, true), { t: [0, 0.5, 0] }, 0);
  return kit.build([slot('Beam', 'light-beam')]);
}

const CANYON_PILLAR = PILLARS.find((p) => p.id.startsWith('canyon'))!;

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.geometry,
  name: 'Nezha / Dragon Palace Greybox',
  build: () =>
    ok({
      'mesh/seabed': single(unwrapMesh(createBoxGeometry(240, 0.4, 240)), 'seabed'),
      'mesh/vortex': vortexDisc(),
      'mesh/water-wall': waterWall(),
      'mesh/lamp': chentangLamp(),
      'mesh/walls': walls(),
      'mesh/trench': trench(),
      'mesh/pillar-canyon': pillar(CANYON_PILLAR.radius, CANYON_PILLAR.height),
      // --- M3 dragon (greybox): unit pieces placed by the dragon plugin every frame ---
      /** Body segment: unit cylinder along +Y (length 1, radius 1), centred. */
      'mesh/dragon-segment': (() => {
        const kit = new MeshKit();
        kit.add(createCylinderGeometry(1, 1, 1, 14, 1, true), {}, 0);
        return kit.build([slot('Scale', 'dragon-front')]);
      })(),
      'mesh/dragon-joint': single(unwrapMesh(createSphereGeometry(1, 14, 10)), 'dragon-front'),
      'mesh/dragon-fin': single(unwrapMesh(createConeGeometry(0.5, 1, 4)), 'dragon-ridge'),
      'mesh/dragon-head': dragonHead(),
      'mesh/dragon-eyes': (() => {
        const kit = new MeshKit();
        for (const side of [-1, 1] as const) kit.add(createSphereGeometry(0.09, 10, 8), { t: [side * 0.33, 0.18, -0.55] }, 0);
        return kit.build([slot('Eyes', 'dragon-eye')]);
      })(),      'mesh/beam': beamShaft(),
      /** A single seaweed blade (tapered, bent); clumps are runtime instances of it. */
      'mesh/seaweed-blade': seaweedBlade(),
      'mesh/marker': single(unwrapMesh(createConeGeometry(0.2, 0.4, 8)), 'pillar'),
      'mesh/quad': single(unwrapMesh(createPlaneGeometry(1, 1)), 'pillar'),
      // --- M2: ground warnings (flat, y = 0, origin at the attacker edge, pointing -Z) ---
      'mesh/warn-line-fill': flat(lineOutline(WARN.lineWidth, WARN.lineLength, 0), 'Fill', 'warn-fill'),
      'mesh/warn-line-edge': flat(lineOutline(WARN.lineWidth, WARN.lineLength, WARN.edge), 'Edge', 'warn-edge'),
      'mesh/warn-line-shrink': flat(lineOutline(WARN.lineWidth, WARN.lineLength, WARN.edge * 0.6), 'Shrink', 'warn-shrink'),
      'mesh/warn-fan-fill': flat(fanOutline(WARN.fanRadius, WARN.fanAngleDeg, 0), 'Fill', 'warn-fill'),
      'mesh/warn-fan-edge': flat(fanOutline(WARN.fanRadius, WARN.fanAngleDeg, WARN.edge), 'Edge', 'warn-edge'),
      'mesh/warn-fan-shrink': flat(fanOutline(WARN.fanRadius, WARN.fanAngleDeg, WARN.edge * 0.6), 'Shrink', 'warn-shrink'),
      /** Flat unit ring (radius 1) for the perfect-dodge burst and the Sash Bind wrap. */
      'mesh/ring': (() => {
        const kit = new MeshKit();
        kit.add(createTorusGeometry(1, 0.035, 8, 64), { r: axisAngle([1, 0, 0], Math.PI / 2) }, 0);
        return kit.build([slot('Ring', 'perfect-ring')]);
      })(),
      /** Spear-tip flame: base at y = 0, end at y = 1 (scaled to the reach at runtime). */
      'mesh/flame': (() => {
        const kit = new MeshKit();
        kit.add(createConeGeometry(0.07, 1, 10), { t: [0, 0.5, 0] }, 0);
        return kit.build([slot('Flame', 'flame')]);
      })(),
    }),
});

/** Tapered two-sided ribbon, 1 m tall (scaled per instance), pivot at its root. */
function seaweedBlade(): MeshAsset {
  const kit = new MeshKit();
  const steps = 5;
  for (let index = 0; index < steps; index += 1) {
    const y0 = index / steps, y1 = (index + 1) / steps;
    const width = 0.09 * (1 - y0 * 0.7);
    const bend = 0.12 * y0 * y0;
    kit.add(createBoxGeometry(width, y1 - y0 + 0.01, 0.012), {
      t: [bend, (y0 + y1) / 2, 0],
      r: axisAngle([0, 0, 1], -0.25 * y0),
    }, 0);
  }
  return kit.build([slot('Blade', 'seaweed')]);
}


type Poly = readonly (readonly [number, number])[];

/** Rectangle from the origin toward -Z. edge = 0 -> filled; edge > 0 -> outline band of that width. */
function lineOutline(width: number, length: number, edge: number): { tris: number[]; pts: number[][] } {
  const w = width / 2;
  const outer: Poly = [[-w, 0], [w, 0], [w, -length], [-w, -length]];
  if (edge === 0) return fillPoly(outer);
  const inner: Poly = [[-w + edge, -edge], [w - edge, -edge], [w - edge, -length + edge], [-w + edge, -length + edge]];
  return band(outer, inner);
}

/** Circular sector from the origin toward -Z. */
function fanOutline(radius: number, angleDeg: number, edge: number): { tris: number[]; pts: number[][] } {
  const steps = 32;
  const half = (angleDeg * Math.PI) / 360;
  const arc = (r: number) => Array.from({ length: steps + 1 }, (_, i) => {
    const a = -half + (2 * half * i) / steps;
    return [r * Math.sin(a), -r * Math.cos(a)] as const;
  });
  const outer: Poly = [[0, 0], ...arc(radius)];
  if (edge === 0) return fillPoly(outer);
  const inset = edge / Math.sin(half);
  const innerArc = arc(radius - edge).map(([x, z]) => [x * (1 - inset / radius), z * (1 - inset / radius) - inset * 0] as const);
  const inner: Poly = [[0, -inset], ...innerArc];
  return band(outer, inner);
}

function fillPoly(poly: Poly) {
  // Convex fan triangulation (rectangle and sector are both convex).
  const pts = poly.map(([x, z]) => [x, z]);
  const tris: number[] = [];
  for (let i = 1; i < pts.length - 1; i += 1) tris.push(0, i + 1, i);
  return { tris, pts };
}

function band(outer: Poly, inner: Poly) {
  const pts = [...outer.map(([x, z]) => [x, z]), ...inner.map(([x, z]) => [x, z])];
  const n = outer.length;
  const tris: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    tris.push(i, n + j, j, i, n + i, n + j);
  }
  return { tris, pts };
}

function flat(shape: { tris: number[]; pts: number[][] }, slotName: string, material: string): MeshAsset {
  const count = shape.pts.length;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  shape.pts.forEach(([x, z], i) => {
    position.set([x!, 0, z!], i * 3);
    normal.set([0, 1, 0], i * 3);
    uv.set([x!, z!], i * 2);
  });
  const built = createMeshBuilder({
    attributes: { position, normal, uv },
    indices: new Uint32Array(shape.tris),
    submeshes: [{ indexOffset: 0, indexCount: shape.tris.length, vertexCount: count, topology: 'triangle-list', materialSlot: 0 }],
    materialSlots: [slot(slotName, material)],
  }).build();
  if (!built.ok) throw built.error;
  return built.value;
}

/** Raw triangle mesh helper (positions / normals / uv / indices). */
function raw(position: number[], normal: number[], uv: number[], indices: number[], slotName: string, material: string): MeshAsset {
  const count = position.length / 3;
  const built = createMeshBuilder({
    attributes: { position: new Float32Array(position), normal: new Float32Array(normal), uv: new Float32Array(uv) },
    indices: new Uint32Array(indices),
    submeshes: [{ indexOffset: 0, indexCount: indices.length, vertexCount: count, topology: 'triangle-list', materialSlot: 0 }],
    materialSlots: [slot(slotName, material)],
  }).build();
  if (!built.ok) throw built.error;
  return built.value;
}

/** Flat polar disc of the vortex floor (r = 20 m); the shader reads positionOS for radius / angle. */
function vortexDisc(): MeshAsset {
  const rings = 24, sectors = 96;
  const position: number[] = [], normal: number[] = [], uv: number[] = [], indices: number[] = [];
  position.push(0, 0, 0); normal.push(0, 1, 0); uv.push(0.5, 0.5);
  for (let r = 1; r <= rings; r += 1) {
    const radius = (ARENA.radius + 0.3) * (r / rings);
    for (let k = 0; k < sectors; k += 1) {
      const a = (k / sectors) * Math.PI * 2;
      position.push(Math.sin(a) * radius, 0, Math.cos(a) * radius);
      normal.push(0, 1, 0);
      uv.push(0.5 + (Math.sin(a) * radius) / 41, 0.5 + (Math.cos(a) * radius) / 41);
    }
  }
  for (let k = 0; k < sectors; k += 1) indices.push(0, 1 + ((k + 1) % sectors), 1 + k);
  for (let r = 1; r < rings; r += 1) {
    const a0 = 1 + (r - 1) * sectors, a1 = 1 + r * sectors;
    for (let k = 0; k < sectors; k += 1) {
      const k1 = (k + 1) % sectors;
      indices.push(a0 + k, a0 + k1, a1 + k, a0 + k1, a1 + k1, a1 + k);
    }
  }
  return raw(position, normal, uv, indices, 'Vortex', 'vortex');
}

/** Inward-facing water wall (r = 26 m), open at the canyon mouth. uv.x = angle / 2π, uv.y = height. */
function waterWall(): MeshAsset {
  const gap = ((ARENA.entranceHalfAngleDeg + 1) * Math.PI) / 180;
  const sectors = 120, rows = 8;
  const position: number[] = [], normal: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let k = 0; k <= sectors; k += 1) {
    const a = gap + (k / sectors) * (Math.PI * 2 - 2 * gap);
    for (let j = 0; j <= rows; j += 1) {
      const y = (j / rows) * ARENA.wallHeight;
      position.push(Math.sin(a) * ARENA.wallRadius, y, Math.cos(a) * ARENA.wallRadius);
      normal.push(-Math.sin(a), 0, -Math.cos(a));
      uv.push(a / (Math.PI * 2), j / rows);
    }
  }
  for (let k = 0; k < sectors; k += 1) {
    for (let j = 0; j < rows; j += 1) {
      const i0 = k * (rows + 1) + j, i1 = (k + 1) * (rows + 1) + j;
      indices.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1);
    }
  }
  return raw(position, normal, uv, indices, 'Water', 'water-wall');
}

/** Chentang fishing lamp (checkpoint), reusing the sea-lamp idea: post + warm lantern. */
function chentangLamp(): MeshAsset {
  const kit = new MeshKit();
  kit.add(createCylinderGeometry(0.06, 0.08, 1.6, 8, 1), { t: [0, 0.8, 0] }, 0);
  kit.add(createSphereGeometry(0.22, 12, 8), { t: [0, 1.75, 0] }, 1);
  return kit.build([slot('Post', 'pillar'), slot('Lantern', 'lamp-glow')]);
}

/**
 * Placeholder dragon head (frozen interface: origin at the neck joint, facing -Z, about 1.5 m
 * wide at the neck). Snout, jaw, 1.2 m antlers and two 3 m white whiskers.
 */
function dragonHead(): MeshAsset {
  const kit = new MeshKit();
  const limb = (a: V3, b: V3, ra: number, rb: number, s: number) => {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d);
    kit.add(createCylinderGeometry(rb, ra, len, 8, 1), { t: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], r: fromTo([0, 1, 0], [d[0] / len, d[1] / len, d[2] / len]) }, s);
  };
  kit.add(createSphereGeometry(0.62, 16, 12), { t: [0, 0.05, 0], s: [1, 0.85, 1.05] }, 0);
  kit.add(createBoxGeometry(0.72, 0.42, 1.1), { t: [0, 0.02, -0.75] }, 0);
  kit.add(createBoxGeometry(0.62, 0.18, 1.0), { t: [0, -0.26, -0.68] }, 0);
  kit.add(createBoxGeometry(0.8, 0.12, 0.35), { t: [0, 0.27, -0.25] }, 2);
  for (const side of [-1, 1] as const) {
    // Antlers: main beam back and up (1.2 m) with a forward tine.
    limb([side * 0.22, 0.42, 0.05], [side * 0.5, 1.2, 0.75], 0.07, 0.03, 1);
    limb([side * 0.38, 0.85, 0.42], [side * 0.62, 1.1, 0.15], 0.035, 0.015, 1);
    // Whiskers: 3 m, drooping from the upper lip.
    limb([side * 0.3, -0.05, -1.2], [side * 1.3, -0.6, -0.4], 0.035, 0.03, 1);
    limb([side * 1.3, -0.6, -0.4], [side * 1.9, -1.1, 1.1], 0.03, 0.012, 1);
  }
  return kit.build([slot('Head', 'dragon-front'), slot('Horn', 'dragon-horn'), slot('Brow', 'dragon-ridge')]);
}
