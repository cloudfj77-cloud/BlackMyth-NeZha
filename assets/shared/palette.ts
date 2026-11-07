/** Shared linear-RGB colours used by both material Packs and runtime material updates. */
export type RGB = readonly [number, number, number];

/** Warm fire palette shared by Nezha's emissive parts. */
export const FIRE_GOLD: RGB = [1.0, 0.55, 0.12];
/** Full-brightness emissive intensity of the Wind-Fire Wheels; idle uses `wheel.emissive` of it (30%). */
export const WHEEL_FULL_INTENSITY = 4;
export const PILLAR_COLOR: RGB = [0.27, 0.33, 0.36];
