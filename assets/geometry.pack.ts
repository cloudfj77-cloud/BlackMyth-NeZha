import { createBoxGeometry, createConeGeometry, createCylinderGeometry, createMeshBuilder, createPlaneGeometry, createTorusGeometry } from '@forgeax/engine/geometry';
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
  PALACE,
  PILLARS,
  seeded,
  TRENCH,
  WARN,
} from './shared/layout.ts';
import { axisAngle, MeshKit, yawQ } from './shared/mesh-kit.ts';
import { canyonWallSegments, ringWallSegments, trenchSegments } from './shared/greybox.ts';


const single = (mesh: MeshAsset, material: string): MeshAsset => ({ ...mesh, materialSlots: [slot('Surface', material)] });

function unwrapMesh(result: ReturnType<typeof createBoxGeometry>): MeshAsset {
  if (!result.ok) throw result.error;
  return result.value;
}

/** All palace and reef walls merged into one mesh (one draw per material); colliders are separate entities. */
function walls(): MeshAsset {
  const kit = new MeshKit();
  for (const segment of ringWallSegments()) {
    kit.add(createBoxGeometry(segment.length, ARENA.wallHeight, ARENA.wallThickness), {
      t: [segment.x, ARENA.wallHeight / 2, segment.z],
      r: yawQ(segment.yaw),
    }, 0);
    // Coping stone on top of the palace wall.
    kit.add(createBoxGeometry(segment.length + 0.05, 0.35, ARENA.wallThickness + 0.4), {
      t: [segment.x, ARENA.wallHeight + 0.17, segment.z],
      r: yawQ(segment.yaw),
    }, 2);
  }
  // Palace facade closing the gate gap, with a recessed gate.
  const facadeWidth = 2 * ARENA.wallRadius * Math.sin((ARENA.gateHalfAngleDeg * Math.PI) / 180) + 3;
  kit.add(createBoxGeometry(facadeWidth, 9, 1.4), { t: [0, 4.5, PALACE.facadeZ - 0.7] }, 0);
  kit.add(createBoxGeometry(4.2, 6, 0.4), { t: [0, 3, PALACE.facadeZ + 0.05] }, 2);
  kit.add(createBoxGeometry(PALACE.hallWidth, PALACE.hallHeight, PALACE.hallDepth), {
    t: [0, PALACE.hallHeight / 2, PALACE.facadeZ - 1.4 - PALACE.hallDepth / 2],
  }, 0);
  kit.add(createBoxGeometry(PALACE.hallWidth + 4, 1.2, PALACE.hallDepth + 4), {
    t: [0, PALACE.hallHeight + 0.6, PALACE.facadeZ - 1.4 - PALACE.hallDepth / 2],
  }, 2);
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

const PLAZA_PILLAR = PILLARS[0]!;
const CANYON_PILLAR = PILLARS.find((p) => p.id.startsWith('canyon'))!;

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.geometry,
  name: 'Nezha / Dragon Palace Greybox',
  build: () =>
    ok({
      'mesh/seabed': single(unwrapMesh(createBoxGeometry(240, 0.4, 240)), 'seabed'),
      'mesh/plaza': single(unwrapMesh(createCylinderGeometry(ARENA.radius + 0.4, ARENA.radius + 0.4, 0.04, 64, 1)), 'jade-plaza'),
      'mesh/walls': walls(),
      'mesh/trench': trench(),
      'mesh/pillar-plaza': pillar(PLAZA_PILLAR.radius, PLAZA_PILLAR.height),
      'mesh/pillar-canyon': pillar(CANYON_PILLAR.radius, CANYON_PILLAR.height),
      /** Unit box: the lock target is scaled at runtime by its Transform (render only). */
      'mesh/lock-target': single(unwrapMesh(createBoxGeometry(1, 1, 1)), 'lock-target'),
      'mesh/beam': beamShaft(),
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
