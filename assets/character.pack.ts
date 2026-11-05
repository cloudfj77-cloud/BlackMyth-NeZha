import {
  createBoxGeometry,
  createConeGeometry,
  createCylinderGeometry,
  createSphereGeometry,
  createTorusGeometry,
} from '@forgeax/engine/geometry';
import { definePack } from '@forgeax/engine/pack/source';
import type { MeshAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS, slot } from './shared/asset-refs.ts';
import { axisAngle, fromTo, MeshKit, type V3 } from './shared/mesh-kit.ts';
import { NEZHA } from './shared/nezha-shape.ts';

/** Cylinder segment between two points (factory cylinders run along local Y). */
function limb(kit: MeshKit, a: V3, b: V3, radiusA: number, radiusB: number, materialSlot: number, segments = 10): void {
  const direction: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(...direction);
  if (length < 1e-4) return;
  const unit: V3 = [direction[0] / length, direction[1] / length, direction[2] / length];
  kit.add(createCylinderGeometry(radiusB, radiusA, length, segments, 1), {
    t: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    r: fromTo([0, 1, 0], unit),
  }, materialSlot);
  kit.add(createSphereGeometry(Math.max(radiusA, radiusB) * 0.98, 10, 6), { t: b }, materialSlot);
}

const SKIN = 0, HAIR = 1, ARMOR = 2, CLOTH = 3, GOLD = 4;

/**
 * Greybox Nezha (rigid, no skeleton in M1). Keeps the three silhouette marks:
 * twin hair buns, the 2.4 m spear (separate mesh) and the sash (runtime ribbon).
 * Model space: wheels' bottom at y = 0, feet at y = 0.1, bun tops at y = 1.75.
 */
function body(): MeshAsset {
  const kit = new MeshKit();
  const feet = NEZHA.wheelHeight;
  for (const side of [-1, 1] as const) {
    const hip: V3 = [side * 0.09, feet + 0.82, 0];
    const knee: V3 = [side * 0.095, feet + 0.43, -0.07];
    const ankle: V3 = [side * NEZHA.footSpacing, feet + 0.07, -0.01];
    limb(kit, hip, knee, 0.075, 0.062, CLOTH);
    limb(kit, knee, ankle, 0.06, 0.045, CLOTH);
    kit.add(createBoxGeometry(0.08, 0.06, 0.22), { t: [side * NEZHA.footSpacing, feet + 0.03, -0.05] }, SKIN);
  }
  // Short armour skirt, torso, belt.
  kit.add(createCylinderGeometry(0.17, 0.21, 0.2, 14, 1), { t: [0, feet + 0.84, 0] }, ARMOR);
  kit.add(createCylinderGeometry(0.19, 0.15, 0.44, 14, 1), { t: [0, feet + 1.12, 0] }, ARMOR);
  kit.add(createCylinderGeometry(0.162, 0.162, 0.05, 14, 1), { t: [0, feet + 0.94, 0] }, GOLD);
  // Shoulders and arms.
  const leftShoulder: V3 = [-0.21, feet + 1.3, 0];
  const rightShoulder: V3 = [0.21, feet + 1.3, 0];
  kit.add(createSphereGeometry(0.075, 10, 6), { t: leftShoulder }, ARMOR);
  kit.add(createSphereGeometry(0.075, 10, 6), { t: rightShoulder }, ARMOR);
  limb(kit, leftShoulder, [-0.27, feet + 1.02, 0.03], 0.05, 0.045, SKIN);
  limb(kit, [-0.27, feet + 1.02, 0.03], [-0.25, feet + 0.8, -0.03], 0.043, 0.04, SKIN);
  const grip = NEZHA.grip;
  limb(kit, rightShoulder, [0.29, feet + 1.12, 0.04], 0.05, 0.045, SKIN);
  limb(kit, [0.29, feet + 1.12, 0.04], [grip[0], grip[1], grip[2]], 0.043, 0.04, SKIN);
  // Universe Ring on the right forearm.
  kit.add(createTorusGeometry(0.05, 0.014, 6, 14), {
    t: [0.28, feet + 0.98, -0.01],
    r: axisAngle([1, 0, 0], Math.PI / 2),
  }, GOLD);
  // Neck, head, hair cap and the twin buns (top of buns = feet + 1.65).
  limb(kit, [0, feet + 1.33, 0], [0, feet + 1.4, 0], 0.05, 0.05, SKIN);
  kit.add(createSphereGeometry(0.115, 16, 12), { t: [0, feet + 1.46, -0.005] }, SKIN);
  kit.add(createSphereGeometry(0.12, 16, 12), { t: [0, feet + 1.49, 0.02], s: [1, 0.92, 1] }, HAIR);
  for (const side of [-1, 1] as const) {
    kit.add(createSphereGeometry(0.065, 12, 8), { t: [side * 0.1, feet + NEZHA.bodyHeight - 0.065, 0.01] }, HAIR);
  }
  return kit.build([
    slot('Skin', 'nezha-skin'),
    slot('Hair', 'nezha-hair'),
    slot('Armor', 'nezha-armor'),
    slot('Cloth', 'nezha-cloth'),
    slot('Gold', 'nezha-gold'),
  ]);
}

/** Spear in grip space: local +Y toward the tip; butt at y = -spearBelowGrip. */
function spear(): MeshAsset {
  const kit = new MeshKit();
  const butt = -NEZHA.spearBelowGrip;
  const tipStart = butt + NEZHA.spearLength - NEZHA.spearTipLength;
  kit.add(createCylinderGeometry(0.02, 0.022, tipStart - butt, 8, 1), { t: [0, (butt + tipStart) / 2, 0] }, 0);
  kit.add(createCylinderGeometry(0.035, 0.035, 0.05, 10, 1), { t: [0, tipStart - 0.02, 0] }, 1);
  kit.add(createConeGeometry(0.032, NEZHA.spearTipLength, 10), { t: [0, tipStart + NEZHA.spearTipLength / 2, 0] }, 2);
  return kit.build([slot('Shaft', 'spear-shaft'), slot('Collar', 'nezha-gold'), slot('Tip', 'spear-tip')]);
}

/** Two horizontal Wind-Fire Wheels with inward-curling flame tongues (idle form). */
function wheels(): MeshAsset {
  const kit = new MeshKit();
  for (const side of [-1, 1] as const) {
    const center: V3 = [side * NEZHA.footSpacing, NEZHA.wheelHeight / 2, -0.03];
    kit.add(createTorusGeometry(NEZHA.wheelRadius, NEZHA.wheelTube, 8, 24), {
      t: center,
      r: axisAngle([1, 0, 0], Math.PI / 2),
    }, 0);
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      const at: V3 = [center[0] + Math.cos(angle) * NEZHA.wheelRadius, center[1] + 0.02, center[2] + Math.sin(angle) * NEZHA.wheelRadius];
      const inward: V3 = [-Math.cos(angle) * 0.6, 1, -Math.sin(angle) * 0.6];
      const length = Math.hypot(...inward);
      kit.add(createConeGeometry(0.03, 0.07, 6), {
        t: at,
        r: fromTo([0, 1, 0], [inward[0] / length, inward[1] / length, inward[2] / length]),
      }, 0);
    }
  }
  return kit.build([slot('Fire', 'wheel-fire')]);
}

/** Unit disc for the contact glow (scaled to `glow.radius` at runtime). */
function glowDisc(): MeshAsset {
  const kit = new MeshKit();
  kit.add(createCylinderGeometry(1, 1, 0.004, 40, 1), {}, 0);
  return kit.build([slot('Glow', 'contact-glow')]);
}

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.character,
  name: 'Nezha / Greybox Character',
  build: () =>
    ok({
      'mesh/nezha-body': body(),
      'mesh/nezha-spear': spear(),
      'mesh/nezha-wheels': wheels(),
      'mesh/contact-glow': glowDisc(),
    }),
});
