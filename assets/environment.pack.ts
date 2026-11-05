import { definePack } from '@forgeax/engine/pack/source';
import type { EquirectAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS, SUN_OUTGOING_DIRECTION } from './shared/asset-refs.ts';

const WIDTH = 256;
const HEIGHT = 128;

/** Scene-linear water colour at the horizon; Fog uses the same value so distance melts into the sea. */
export const WATER_HORIZON = [0.018, 0.085, 0.13] as const;
const WATER_ABYSS = [0.003, 0.012, 0.024] as const;
const SURFACE_ZENITH = [0.16, 0.48, 0.58] as const;
const SURFACE_GLOW = [0.7, 0.95, 1.0] as const;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Underwater light field: a bright rippled sea surface overhead (Snell's
 * window), deepening blue toward the horizon and a near-black abyss below.
 */
function underwater(): EquirectAsset {
  const pixels = new Float32Array(WIDTH * HEIGHT * 4);
  const outgoingLength = Math.hypot(...SUN_OUTGOING_DIRECTION);
  const sun = SUN_OUTGOING_DIRECTION.map((value) => -value / outgoingLength) as [number, number, number];
  for (let y = 0; y < HEIGHT; y += 1) {
    const latitude = Math.PI * (0.5 - (y + 0.5) / HEIGHT);
    const cosLatitude = Math.cos(latitude);
    for (let x = 0; x < WIDTH; x += 1) {
      const longitude = Math.PI * (2 * ((x + 0.5) / WIDTH) - 1);
      const direction = [
        cosLatitude * Math.sin(longitude),
        Math.sin(latitude),
        cosLatitude * Math.cos(longitude),
      ] as const;
      const up = direction[1];
      const sunAlignment = clamp(direction[0] * sun[0] + direction[1] * sun[1] + direction[2] * sun[2]);
      // Snell's window: everything above ~48 degrees from zenith sees the bright surface.
      const window = smoothstep(0.55, 0.85, up);
      const ripple = 0.85 + 0.15 * Math.sin(longitude * 9 + Math.sin(latitude * 14) * 2) * Math.sin(latitude * 23);
      const glow = sunAlignment ** 24 * 2.2 + sunAlignment ** 6 * 0.35;
      const upper = smoothstep(-0.05, 0.6, up);
      const lower = smoothstep(-0.6, 0.0, up);
      const rgb = [0, 1, 2].map((channel) => {
        const deep = WATER_ABYSS[channel]! + (WATER_HORIZON[channel]! - WATER_ABYSS[channel]!) * lower;
        const mid = deep + (SURFACE_ZENITH[channel]! * 0.55 - deep) * upper * upper;
        return mid + SURFACE_ZENITH[channel]! * window * ripple * 1.4 + SURFACE_GLOW[channel]! * glow * window;
      });
      pixels.set([rgb[0]!, rgb[1]!, rgb[2]!, 1], (y * WIDTH + x) * 4);
    }
  }
  return {
    kind: 'equirect',
    width: WIDTH,
    height: HEIGHT,
    format: 'rgba32float',
    data: new Uint8Array(pixels.buffer),
    colorSpace: 'linear',
  };
}

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.environment,
  name: 'Nezha / Underwater Environment',
  build: () => ok({ 'environment/underwater': underwater() }),
});
