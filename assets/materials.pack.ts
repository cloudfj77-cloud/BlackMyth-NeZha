import { definePack } from '@forgeax/engine/pack/source';
import { Materials } from '@forgeax/engine/render';
import type { MaterialRootAsset } from '@forgeax/engine/types';
import { ok, RenderQueue } from '@forgeax/engine/types';
import { PACKAGE_IDS } from './shared/asset-refs.ts';

import { FIRE_GOLD, PILLAR_COLOR, WHEEL_FULL_INTENSITY, type RGB } from './shared/palette.ts';

/**
 * Greybox palette. Environment is cool only (deep blue, teal, slate); the
 * only warm colours belong to Nezha (wheels, sash, spear tip, contact glow).
 */
const std = (
  color: RGB,
  options: {
    readonly metallic?: number;
    readonly roughness?: number;
    readonly emissive?: RGB;
    readonly emissiveIntensity?: number;
    readonly twoSided?: boolean;
    readonly alphaHash?: boolean;
  } = {},
): MaterialRootAsset =>
  Materials.standard({
    baseColor: [color[0], color[1], color[2], 1],
    metallic: options.metallic ?? 0,
    roughness: options.roughness ?? 0.8,
    ...(options.emissive !== undefined ? { emissive: options.emissive, emissiveIntensity: options.emissiveIntensity ?? 1 } : {}),
    ...(options.twoSided ? { renderState: { cullMode: 'none' as const } } : {}),
    ...(options.alphaHash ? { alphaHash: true } : {}),
  });

const ADDITIVE = {
  blend: {
    color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
  },
  depthWriteEnabled: false,
  cullMode: 'none',
} as const;

/** Emission-only light added on top: one/one colour, alpha untouched, no fog. */
const GLOW = {
  blend: {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
  },
  depthWriteEnabled: false,
  cullMode: 'none',
  fog: false,
} as const;

const ALPHA_BLEND = {
  blend: {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  },
  depthWriteEnabled: false,
} as const;


export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.materials,
  name: 'Nezha / Materials',
  build: () =>
    ok({
      // --- Environment (cool only) ------------------------------------------------
      'material/seabed': std([0.085, 0.11, 0.13], { roughness: 0.95 }),
      'material/jade-plaza': std([0.36, 0.44, 0.45], { roughness: 0.45 }),
      'material/reef-rock': std([0.06, 0.08, 0.1], { roughness: 0.95 }),
      'material/palace-wall': std([0.13, 0.19, 0.23], { roughness: 0.7 }),
      'material/palace-roof': std([0.04, 0.12, 0.16], { metallic: 0.3, roughness: 0.4 }),
      'material/trench-rock': std([0.03, 0.05, 0.07], { roughness: 0.95 }),
      'material/pillar': std(PILLAR_COLOR, { roughness: 0.6 }),
      /** Dithered (Alpha Hash) twin used while a pillar fades; still opaque queue + depth writes. */
      'material/pillar-fade': Materials.standard({
        surfaceModule: 'nezha::pillar_fade_surface',
        parameters: [
          { name: 'baseColor', type: 'color' },
          { name: 'rimColor', type: 'color' },
          { name: 'fade', type: 'f32' },
          { name: 'rimWidth', type: 'f32' },
          { name: 'cellsPerMeter', type: 'f32' },
        ],
        values: { baseColor: [PILLAR_COLOR[0], PILLAR_COLOR[1], PILLAR_COLOR[2], 1], rimColor: [0.35, 0.62, 0.72, 1], fade: 1, rimWidth: 0.22, cellsPerMeter: 36 },
      }),
      /** Fallback B2: 35% blended translucency. */
      'material/pillar-glass': Materials.standard({
        baseColor: [PILLAR_COLOR[0], PILLAR_COLOR[1], PILLAR_COLOR[2], 0.35],
        roughness: 0.6,
        renderState: ALPHA_BLEND,
        queue: RenderQueue.Transparent,
      }),
      'material/lock-target': std([0.07, 0.15, 0.17], { metallic: 0.4, roughness: 0.45 }),
      'material/seaweed': std([0.04, 0.15, 0.12], { roughness: 0.7, twoSided: true }),
      'material/particle': Materials.unlit([0.62, 0.62, 0.58, 0.35], { renderState: ADDITIVE, queue: RenderQueue.Transparent }),
      'material/light-beam': Materials.standard({
        surfaceModule: 'nezha::light_beam_surface',
        parameters: [
          { name: 'beamColor', type: 'color' },
          { name: 'intensity', type: 'f32' },
        ],
        values: { beamColor: [0.45, 0.78, 1.0, 1], intensity: 0.35 },
        renderState: ADDITIVE,
        queue: RenderQueue.Transparent,
      }),

      // --- Nezha placeholder ------------------------------------------------------
      'material/nezha-skin': std([0.78, 0.6, 0.5], { roughness: 0.6 }),
      'material/nezha-hair': std([0.03, 0.028, 0.032], { roughness: 0.5 }),
      'material/nezha-armor': std([0.5, 0.05, 0.04], { roughness: 0.45 }),
      'material/nezha-cloth': std([0.82, 0.8, 0.74], { roughness: 0.75 }),
      'material/nezha-gold': std([0.9, 0.66, 0.26], { metallic: 1, roughness: 0.3 }),
      'material/spear-shaft': std([0.32, 0.05, 0.04], { roughness: 0.4 }),
      'material/spear-tip': std([1.0, 0.6, 0.2], { roughness: 0.3, emissive: FIRE_GOLD, emissiveIntensity: 4 }),
      'material/wheel-fire': std([0.3, 0.1, 0.02], {
        roughness: 0.4,
        emissive: [1.0, 0.36, 0.05],
        emissiveIntensity: WHEEL_FULL_INTENSITY * 0.3,
      }),
      'material/sash': std([0.5, 0.03, 0.02], { roughness: 0.4, twoSided: true, emissive: [1.0, 0.09, 0.03], emissiveIntensity: 1.25 }),
      'material/contact-glow': Materials.standard({
        surfaceModule: 'nezha::contact_glow_surface',
        parameters: [
          { name: 'glowColor', type: 'color' },
          { name: 'intensity', type: 'f32' },
        ],
        values: { glowColor: [FIRE_GOLD[0], FIRE_GOLD[1] * 0.85, FIRE_GOLD[2], 1], intensity: 0.9 },
        renderState: GLOW,
        // Drawn first among transparents: ground warnings (M3) layer above it.
        queue: RenderQueue.Transparent - 10,
      }),
      /** Silhouette review (dev grey mode): every Nezha part becomes one mid grey. */
      'material/grey': std([0.4, 0.4, 0.4], { roughness: 0.8 }),
    }),
});
