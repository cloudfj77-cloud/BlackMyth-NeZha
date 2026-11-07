/** Physics collision groups (Rapier packing: membership << 16 | filter). */
export const GROUPS = Object.freeze({
  /** Visible static level geometry (seabed, reef walls, palace wall): blocks characters and the camera. */
  world: 0x0001_ffff,
  player: 0x0002_ffff,
  /** Lock-on placeholder target: blocks the player, never the camera. */
  target: 0x0004_ffff,
  /** Invisible boundary walls: block characters but never the camera. */
  boundary: 0x0008_ffff,
  /** Standing pillars: block characters; the camera fades them instead of pulling in. */
  pillar: 0x0010_ffff,
});

/** Camera boom probes only see visible static level geometry (group 1). */
export const CAMERA_RAY_FILTER = 0xffff_0001 >>> 0;
/** Occlusion probes from the camera toward Nezha only see pillars (group 5). */
export const PILLAR_RAY_FILTER = 0xffff_0010 >>> 0;
