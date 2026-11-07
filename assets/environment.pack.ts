import { definePack } from '@forgeax/engine/pack/source';
import type { EquirectAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { PACKAGE_IDS, SUN_OUTGOING_DIRECTION } from './shared/asset-refs.ts';

const WIDTH = 256;
const HEIGHT = 128;

/** Scene-linear water colour at the horizon (old underwater level). */
export const WATER_HORIZON = [0.018, 0.085, 0.13] as const;

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** 陈塘关 sea fog (v1.4.0 0x7d9aa2), scene-linear; the camera clear colour and slow-motion tint use it too. */
export const SEA_FOG = [lin(0x7d / 255), lin(0x9a / 255), lin(0xa2 / 255)] as const;
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

// --- 陈塘关 sky (v1.4.0 sea.js sky shader, ported to a baked HDR equirect) -------------------
const fract = (v: number) => v - Math.floor(v);
const hash = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}
function fbm(x: number, y: number): number {
  let s = 0, a = 0.5;
  for (let i = 0; i < 5; i += 1) { s += a * vnoise(x, y); x *= 2.03; y *= 2.03; a *= 0.5; }
  return s;
}

/** Overcast sea sky: grey-green horizon, slate zenith, a cold sun glow low in the south, drifting cloud. */
function seaSky(): EquirectAsset {
  const W = 512, H = 256;
  const pixels = new Float32Array(W * H * 4);
  const outLen = Math.hypot(...SUN_OUTGOING_DIRECTION);
  const sun = SUN_OUTGOING_DIRECTION.map((v) => -v / outLen) as [number, number, number];
  const hor = [0.62, 0.70, 0.72], zen = [0.16, 0.22, 0.30], sea = [0.10, 0.18, 0.22];
  for (let y = 0; y < H; y += 1) {
    const latitude = Math.PI * (0.5 - (y + 0.5) / H);
    const cl = Math.cos(latitude);
    for (let x = 0; x < W; x += 1) {
      const longitude = Math.PI * (2 * ((x + 0.5) / W) - 1);
      const d = [cl * Math.sin(longitude), Math.sin(latitude), cl * Math.cos(longitude)] as const;
      const up = d[1];
      const k1 = smoothstep(0, 0.6, up), k2 = smoothstep(0, -0.1, up);
      const s = Math.max(0, d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2]);
      let col = [0, 1, 2].map((i) => {
        let c = hor[i]! + (zen[i]! - hor[i]!) * k1;
        c = c + (sea[i]! - c) * k2;
        return c + [0.9, 0.95, 1.0][i]! * s ** 10 * 0.35 + [1.0, 0.95, 0.85][i]! * s ** 120 * 0.8;
      });
      if (up > 0) {
        const u = d[0] / (up + 0.1) * 1.3, v = d[2] / (up + 0.1) * 1.3;
        const c = smoothstep(0.35, 0.75, fbm(u, v));
        const cc = [0, 1, 2].map((i) => [0.30, 0.34, 0.38][i]! + ([0.85, 0.88, 0.9][i]! - [0.30, 0.34, 0.38][i]!) * s ** 4);
        const m = c * 0.75 * smoothstep(0, 0.2, up);
        col = col.map((v2, i) => v2 + (cc[i]! - v2) * m);
      }
      // v1.4.0 wrote these as display values: bring them to scene-linear for the HDR sky.
      pixels.set([lin(Math.min(1, col[0]!)) * 1.15, lin(Math.min(1, col[1]!)) * 1.15, lin(Math.min(1, col[2]!)) * 1.15, 1], (y * W + x) * 4);
      // The sun disc itself stays above display white so bloom / tone mapping keep it hot.
      if (s > 0.9995) pixels.set([6, 5.8, 5.4, 1], (y * W + x) * 4);
    }
  }
  return { kind: 'equirect', width: W, height: H, format: 'rgba32float', data: new Uint8Array(pixels.buffer), colorSpace: 'linear' };
}

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.environment,
  name: 'Nezha / Underwater Environment',
  build: () => ok({ 'environment/underwater': underwater(), 'environment/sea-sky': seaSky() }),
});
