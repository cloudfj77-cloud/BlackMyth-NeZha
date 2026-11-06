import { AssetGuid } from '@forgeax/engine/pack/guid';
import { definePackageId } from '@forgeax/engine/pack/source';
import type { PackageId } from '@forgeax/engine/pack/source';
import type { AssetGuid as AssetGuidType, MeshMaterialSlot } from '@forgeax/engine/types';

export function guidText(value: AssetGuidType): string {
  return AssetGuid.format(value);
}

export function assetGuid(packageId: PackageId, sourceKey: string): AssetGuidType {
  return AssetGuid.derive(packageId, sourceKey);
}

/** One package namespace per authored Pack; GUID = UUIDv5(packageId, sourceKey). */
export const PACKAGE_IDS = Object.freeze({
  environment: definePackageId('019fb7ce-3100-7000-8000-000000000000'),
  materials: definePackageId('019fb7ce-3200-7000-8000-000000000000'),
  geometry: definePackageId('019fb7ce-3300-7000-8000-000000000000'),
  scene: definePackageId('019fb7ce-3400-7000-8000-000000000000'),
  ui: definePackageId('019fb7ce-3600-7000-8000-000000000000'),
  character: definePackageId('019fb7ce-3700-7000-8000-000000000000'),
  corePlugin: definePackageId('019fb7ce-4100-7000-8000-000000000000'),
  hoverPlayerPlugin: definePackageId('019fb7ce-4200-7000-8000-000000000000'),
  cameraPlugin: definePackageId('019fb7ce-4300-7000-8000-000000000000'),
  lockOnPlugin: definePackageId('019fb7ce-4400-7000-8000-000000000000'),
  occlusionPlugin: definePackageId('019fb7ce-4500-7000-8000-000000000000'),
  floatFxPlugin: definePackageId('019fb7ce-4600-7000-8000-000000000000'),
  ambientPlugin: definePackageId('019fb7ce-4700-7000-8000-000000000000'),
  combatPlugin: definePackageId('019fb7ce-4800-7000-8000-000000000000'),
  trainingPlugin: definePackageId('019fb7ce-4900-7000-8000-000000000000'),
  dragonPlugin: definePackageId('019fb7ce-4a00-7000-8000-000000000000'),
  fightPlugin: definePackageId('019fb7ce-4b00-7000-8000-000000000000'),
  rigPlugin: definePackageId('019fb7ce-4c00-7000-8000-000000000000'),
  seaPlugin: definePackageId('019fb7ce-4d00-7000-8000-000000000000'),
});

export const materialGuid = (key: string): AssetGuidType => assetGuid(PACKAGE_IDS.materials, `material/${key}`);
export const geometryGuid = (key: string): AssetGuidType => assetGuid(PACKAGE_IDS.geometry, `mesh/${key}`);
export const characterGuid = (key: string): AssetGuidType => assetGuid(PACKAGE_IDS.character, `mesh/${key}`);
export const pluginGuid = (packageId: PackageId, key: string): string => guidText(assetGuid(packageId, `plugin/${key}`));

/** Direction stored by DirectionalLight: outgoing from the sea-surface glow toward the seabed. */
/** 陈塘关 low cold sun in the south-east behind the boss platform (v1.4.0 sunDir (0.45, 0.28, −0.85), reversed). */
export const SUN_OUTGOING_DIRECTION = [-0.449, -0.28, 0.849] as const;

/** Mesh material slot; source keys must be unique per mesh, so derive them from the slot name and material. */
export const slot = (name: string, material: string): MeshMaterialSlot => ({
  slotName: name,
  sourceKey: `nezha:${name.toLowerCase().replace(/\s+/g, '-')}:${material}`,
  defaultMaterial: materialGuid(material),
});
