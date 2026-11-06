import { definePack } from '@forgeax/engine/pack/source';
import { linearRgb, RIG_MATERIALS, rigMaterialKey } from './nezha-rig/rig-def.ts';
import { Y_MATERIALS, yMaterialKey, type YMaterial } from './yaksha/rig-def.ts';
import { Materials } from '@forgeax/engine/render';
import type { MaterialRootAsset } from '@forgeax/engine/types';
import { ok, RenderQueue } from '@forgeax/engine/types';
import { PACKAGE_IDS } from './shared/asset-refs.ts';
import { LEVEL_SCALE, SEA } from './shared/sea-layout.ts';

/** v1.4.0 colour × its texture's average brightness, scene-linear. */
const sc = (hex: number, k: number): RGB => { const c = linearRgb(hex); return [c[0] * k, c[1] * k, c[2] * k]; };
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** v1.4.0 shader colours were display values. */
const lin3 = (r: number, g: number, b: number): [number, number, number] => [lin(r), lin(g), lin(b)];

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

/** Emission-only glow material with a runtime `intensity` (afterimages, rings, warnings). */
const glow = (color: RGB, intensity: number): MaterialRootAsset =>
  Materials.standard({
    surfaceModule: 'nezha::flat_glow_surface',
    parameters: [
      { name: 'glowColor', type: 'color' },
      { name: 'intensity', type: 'f32' },
    ],
    values: { glowColor: [color[0], color[1], color[2], 1], intensity },
    renderState: GLOW,
    queue: RenderQueue.Transparent,
  });

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
        values: { baseColor: [PILLAR_COLOR[0], PILLAR_COLOR[1], PILLAR_COLOR[2], 1], rimColor: [0.35, 0.62, 0.72, 1], fade: 1, rimWidth: 0.22, cellsPerMeter: 160 },
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
      // --- M2 combat ----------------------------------------------------------------
      'material/wheel-fire-full': std([0.3, 0.1, 0.02], { roughness: 0.4, emissive: [1.0, 0.36, 0.05], emissiveIntensity: WHEEL_FULL_INTENSITY }),
      'material/sash-live': Materials.standard({
        surfaceModule: 'nezha::sash_surface',
        parameters: [
          { name: 'baseColor', type: 'color' },
          { name: 'sashColor', type: 'color' },
          { name: 'goldColor', type: 'color' },
          { name: 'brightness', type: 'f32' },
          { name: 'fill', type: 'f32' },
          { name: 'flash', type: 'f32' },
        ],
        values: { baseColor: [0.5, 0.03, 0.02, 1], sashColor: [1.25, 0.11, 0.04, 1], goldColor: [1.0, 0.7, 0.2, 1], brightness: 1, fill: 0, flash: 0 },
        renderState: { cullMode: 'none' },
      }),
      // Jointed Nezha (v1.4.0 port, boss 11-06 batch 2).
      ...Object.fromEntries(Object.entries(RIG_MATERIALS).map(([key, m]) => [
        `material/${rigMaterialKey(key as keyof typeof RIG_MATERIALS)}`,
        std(linearRgb(m.color), {
          roughness: m.rough,
          metallic: 'metal' in m ? m.metal : 0,
          ...('emissive' in m ? { emissive: linearRgb(m.emissive), emissiveIntensity: 'emissiveIntensity' in m ? m.emissiveIntensity : 1 } : {}),
        }),
      ])),
      // v1.4.0 silk for the extra ribbons (arm / waist sashes, hair ribbons, spear tassel), two-sided.
      'material/nz-silk': std(linearRgb(0xb8100a), { roughness: 0.5, emissive: linearRgb(0x300400), emissiveIntensity: 1, twoSided: true }),
      'material/afterimage-cloud': Materials.standard({
        surfaceModule: 'nezha::ghost_cloud_surface',
        parameters: [
          { name: 'coreColor', type: 'color' },
          { name: 'rimColor', type: 'color' },
          { name: 'intensity', type: 'f32' },
        ],
        values: { coreColor: [0.95, 0.22, 0.03, 1], rimColor: [1.0, 0.62, 0.12, 1], intensity: 0.7 },
        renderState: { ...ALPHA_BLEND, cullMode: 'none', fog: false },
        queue: RenderQueue.Transparent,
      }),
      'material/afterimage': Materials.standard({
        surfaceModule: 'nezha::ghost_surface',
        parameters: [
          { name: 'coreColor', type: 'color' },
          { name: 'rimColor', type: 'color' },
          { name: 'intensity', type: 'f32' },
        ],
        values: { coreColor: [0.95, 0.22, 0.03, 1], rimColor: [1.0, 0.62, 0.12, 1], intensity: 0.7 },
        renderState: { ...ALPHA_BLEND, cullMode: 'none', fog: false },
        queue: RenderQueue.Transparent,
      }),
      // v1.4.0 1.4.0: the perfect-dodge ring at her feet is cyan (灵息), with the qi sparks gathering in.
      'material/perfect-ring': glow([0.45, 0.92, 1.0], 1.5),
      'material/qi-spark': Materials.unlit([0.55, 0.95, 1.0, 1], { renderState: { ...ADDITIVE, fog: false }, queue: RenderQueue.Transparent }),
      'material/spark': Materials.unlit([1.0, 0.35, 0.03, 1], { renderState: { ...ADDITIVE, fog: false }, queue: RenderQueue.Transparent }),
      'material/flame': Materials.standard({
        surfaceModule: 'nezha::flame_surface',
        parameters: [
          { name: 'rootColor', type: 'color' },
          { name: 'tipColor', type: 'color' },
          { name: 'intensity', type: 'f32' },
        ],
        values: { rootColor: [1.6, 1.25, 0.7, 1], tipColor: [1.0, 0.42, 0.06, 1], intensity: 1 },
        renderState: GLOW,
        queue: RenderQueue.Transparent,
      }),
      // Ice-cyan #7FE6F0 ground warnings with a deep-blue edge: the only things that flicker and shrink.
      'material/warn-fill': glow([0.21, 0.79, 0.87], 0.45),
      'material/warn-shrink': glow([0.21, 0.79, 0.87], 1.2),
      'material/warn-edge': Materials.unlit([0.01, 0.04, 0.16, 0.9], { renderState: { ...ALPHA_BLEND, cullMode: 'none', fog: false }, queue: RenderQueue.Transparent }),
      // Sash Bind wrap: crimson #B8142A with gold.
      'material/bind-crimson': glow([0.48, 0.006, 0.024], 2.2),
      'material/bind-gold': glow([1.0, 0.7, 0.2], 1.4),

      // --- M3 boss field and dragon (greybox) ------------------------------------------
      'material/vortex': Materials.standard({
        surfaceModule: 'nezha::vortex_surface',
        parameters: [
          { name: 'baseColor', type: 'color' },
          { name: 'ta', type: 'f32' },
          { name: 'tb', type: 'f32' },
          { name: 'wa', type: 'f32' },
          { name: 'innerDegPerSec', type: 'f32' },
          { name: 'outerDegPerSec', type: 'f32' },
          { name: 'calmRadius', type: 'f32' },
          { name: 'calmContrast', type: 'f32' },
          { name: 'outerContrast', type: 'f32' },
        ],
        values: { baseColor: [0.11, 0.14, 0.16, 1], ta: 0, tb: 0, wa: 1, innerDegPerSec: 1, outerDegPerSec: 2, calmRadius: 14, calmContrast: 0.07, outerContrast: 0.2 },
      }),
      'material/water-wall': Materials.standard({
        surfaceModule: 'nezha::water_wall_surface',
        parameters: [
          { name: 'waterColor', type: 'color' },
          { name: 'phase', type: 'f32' },
        ],
        values: { waterColor: [0.013, 0.0595, 0.117, 1], phase: 0 },
        renderState: { ...ALPHA_BLEND, cullMode: 'none' },
        queue: RenderQueue.Transparent + 5,
      }),
      // --- 东海 · 陈塘关 (v1.4.0 sea.js colours; its noise textures folded in as darker flat colours) ---
      'material/sea-stone': std(sc(0x6a767c, 0.8), { roughness: 0.85 }),
      'material/sea-rock': std(sc(0x6c7a80, 0.72), { roughness: 0.9 }),
      'material/sea-wet-rock': std(sc(0x4a5a62, 0.75), { roughness: 0.45, metallic: 0.1 }),
      'material/sea-wood': std(linearRgb(0x7a8480), { roughness: 0.82 }),
      'material/sea-jade': std(linearRgb(0x1f5a5c), { roughness: 0.32, metallic: 0.55, emissive: linearRgb(0x021212), emissiveIntensity: 1 }),
      'material/sea-jade-dark': std(linearRgb(0x1c4a52), { roughness: 0.5, metallic: 0.3 }),
      'material/sea-gold': std(linearRgb(0xc9a24a), { roughness: 0.3, metallic: 1 }),
      'material/sea-red-lac': std(linearRgb(0x8a1c14), { roughness: 0.55 }),
      'material/sea-tile': std(sc(0x4a7a86, 0.55), { roughness: 0.6 }),
      'material/sea-coral': std(linearRgb(0x9a4a3e), { roughness: 0.8, emissive: linearRgb(0x0a0202), emissiveIntensity: 1 }),
      'material/sea-lamp-glow': std(linearRgb(0x9ff6ff), { emissive: linearRgb(0x3ad8ff), emissiveIntensity: 2.4 }),
      'material/sea-lotus': std(linearRgb(0xf6b0c0), { roughness: 0.5, emissive: linearRgb(0x6a1a2a), emissiveIntensity: 0.6 }),
      'material/sea-lotus-pad': std(linearRgb(0x3f7a3a), { roughness: 0.7, twoSided: true }),
      'material/sea-pond': std(linearRgb(0x1a4a4a), { roughness: 0.15, metallic: 0.3 }),
      'material/sea-plaque': std(linearRgb(0x0f2a2c), { roughness: 0.5, metallic: 0.2 }),
      'material/sea-far': std(linearRgb(0x3a5a62), { roughness: 0.7, metallic: 0.2 }),
      'material/sea-far-roof': std(sc(0x2a4048, 0.7), { roughness: 0.6 }),
      'material/sea-far-gold': std(linearRgb(0x8a7a4a), { roughness: 0.4, metallic: 0.8 }),
      // 巡海夜叉 (v1.4.0 buildYaksha colours) and its red wind-up fan.
      ...Object.fromEntries((Object.keys(Y_MATERIALS) as YMaterial[]).map((m) => {
        const d = Y_MATERIALS[m] as { color: number; rough: number; metal?: number; emissive?: number; emissiveIntensity?: number; twoSided?: boolean };
        return [`material/${yMaterialKey(m)}`, std(linearRgb(d.color), { roughness: d.rough, metallic: d.metal ?? 0, ...(d.emissive !== undefined ? { emissive: linearRgb(d.emissive), emissiveIntensity: d.emissiveIntensity ?? 1 } : {}), twoSided: d.twoSided ?? false })];
      })),
      'material/yaksha-warn': glow(linearRgb(0xff3010), 0.6),
      // 敖丙 ice (v1.4.0 spikeMat 0xc8f6ff / emissive 0x2a9aff; p2Color 0x6ae8ff for rings and shock waves).
      'material/wheel-halo': glow(linearRgb(0xff4a0a), 0.5),
      'material/ice-spike': std(linearRgb(0xc8f6ff), { roughness: 0.1, emissive: linearRgb(0x2a9aff), emissiveIntensity: 0.8 }),
      'material/ice-glow': glow(linearRgb(0x6af0ff), 0.9),
      'material/ice-shock': glow(linearRgb(0x6ae8ff), 1.2),
      'material/dust-shock': glow(linearRgb(0xd8c8a8), 0.7),
      'material/sea-spray': Materials.unlit([...lin3(0.81, 0.96, 1.0), 0.45], { renderState: ADDITIVE, queue: RenderQueue.Transparent }),
      'material/sea-rune': glow(linearRgb(0x3aa8c0), 0.3),
      'material/sea-taiji': Materials.unlit([...linearRgb(0x0e2a30), 0.5], { renderState: { ...ALPHA_BLEND, cullMode: 'none' }, queue: RenderQueue.Transparent }),
      'material/sea-water': Materials.standard({
        surfaceModule: 'nezha::sea_surface',
        parameters: [
          { name: 'deepColor', type: 'color' },
          { name: 'shallowColor', type: 'color' },
          { name: 'foamColor', type: 'color' },
          { name: 'seaY', type: 'f32' },
          { name: 'swell', type: 'f32' },
          { name: 'glow', type: 'f32' },
        ],
        values: { deepColor: [...lin3(0.02, 0.09, 0.12), 1], shallowColor: [...lin3(0.07, 0.3, 0.33), 1], foamColor: [...lin3(0.88, 0.94, 0.95), 1], seaY: SEA.seaY, swell: 1.0 * LEVEL_SCALE, glow: 0.35 },
      }),
      'material/sea-veil': Materials.standard({
        surfaceModule: 'nezha::sea_veil_surface',
        parameters: [
          { name: 'lowColor', type: 'color' },
          { name: 'highColor', type: 'color' },
          { name: 'op', type: 'f32' },
          { name: 'intensity', type: 'f32' },
        ],
        values: { lowColor: [...lin3(0.2, 0.6, 0.7), 1], highColor: [...lin3(0.8, 1, 1), 1], op: 1, intensity: 1 },
        renderState: { blend: GLOW.blend, depthWriteEnabled: false, cullMode: 'none' },
        queue: RenderQueue.Transparent + 6,
      }),
      'material/lamp-glow': std([1.0, 0.78, 0.45], { emissive: [1.0, 0.62, 0.28], emissiveIntensity: 3 }),
      // Dragon body bands (#7FA295 / #587A6D / #25342E), ridge #587A6D, horns & whiskers #E6E3DA.
      'material/dragon-front': std([0.2122, 0.3613, 0.3005], { metallic: 0.2, roughness: 0.55, emissive: [0.25, 0.8, 1.0], emissiveIntensity: 0 }),
      'material/dragon-mid': std([0.0976, 0.1946, 0.1529], { metallic: 0.2, roughness: 0.55, emissive: [0.25, 0.8, 1.0], emissiveIntensity: 0 }),
      'material/dragon-tail': std([0.0185, 0.0343, 0.0273], { metallic: 0.2, roughness: 0.6, emissive: [0.25, 0.8, 1.0], emissiveIntensity: 0 }),
      // Camera see-through (same route as the pillars, boss 15:54「毛玻璃」): 35 % blended band colour.
      'material/dragon-front-glass': Materials.standard({ baseColor: [0.2122, 0.3613, 0.3005, 0.35], roughness: 0.55, renderState: { ...ALPHA_BLEND, cullMode: 'none' }, queue: RenderQueue.Transparent }),
      'material/dragon-mid-glass': Materials.standard({ baseColor: [0.0976, 0.1946, 0.1529, 0.35], roughness: 0.55, renderState: { ...ALPHA_BLEND, cullMode: 'none' }, queue: RenderQueue.Transparent }),
      'material/dragon-tail-glass': Materials.standard({ baseColor: [0.0185, 0.0343, 0.0273, 0.35], roughness: 0.6, renderState: { ...ALPHA_BLEND, cullMode: 'none' }, queue: RenderQueue.Transparent }),
      'material/dragon-ridge': std([0.0976, 0.1946, 0.1529], { roughness: 0.5 }),
      'material/dragon-horn': std([0.7913, 0.7682, 0.7011], { roughness: 0.6 }),
      /** Moon-cyan eyes #CFE7E4: steady glow at 30 % (50 % telegraph, 15 % opening, 0 closed). Never flickers. */
      'material/dragon-eye': glow([0.624, 0.7991, 0.7758], 0.3),

      /** Silhouette review (dev grey mode): every Nezha part becomes one mid grey. */
      'material/grey': std([0.4, 0.4, 0.4], { roughness: 0.8 }),
    }),
});
