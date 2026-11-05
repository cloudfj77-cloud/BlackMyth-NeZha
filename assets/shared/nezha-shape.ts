/**
 * Placeholder Nezha proportions (one authority for the mesh build and the QA
 * silhouette check). Model space: origin at the bottom of the Wind-Fire Wheels
 * (that point floats `move.hoverHeight` above the seabed), +Y up, facing -Z.
 */
export const NEZHA = Object.freeze({
  /** Height of the wheel ring; the bare feet rest on top of it. */
  wheelHeight: 0.1,
  /** Feet-to-top-of-hair-buns height (silhouette rule: 1.65 m). */
  bodyHeight: 1.65,
  /** Fire-Tipped Spear overall length, butt to tip (silhouette rule: 2.4 m). */
  spearLength: 2.4,
  spearTipLength: 0.2,
  /** Right-hand grip in model space and the spear's forward tilt. */
  grip: [0.27, 1.0, -0.06] as const,
  /** Distance from the grip down to the spear butt. */
  spearBelowGrip: 0.95,
  spearTiltDeg: 14,
  wheelRadius: 0.17,
  wheelTube: 0.04,
  footSpacing: 0.1,
});

/** Feet sole height in model space. */
export const FEET_Y = NEZHA.wheelHeight;
/** Top of the hair buns in model space. */
export const HEAD_TOP_Y = NEZHA.wheelHeight + NEZHA.bodyHeight;
/** Sash anchors (shoulders, model space): the two strands of the Red Armillary Sash start here. */
export const SASH_ANCHORS = [
  [-0.17, 1.47, 0.07],
  [0.17, 1.47, 0.07],
] as const;
