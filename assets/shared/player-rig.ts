import TUNING from '../data/tuning.json' with { type: 'json' };

/** Clearance between the capsule bottom and the seabed (character-controller skin). */
export const CAPSULE_SKIN = 0.02;
/** Capsule centre height above the seabed; the player root entity is the capsule. */
export const CAPSULE_CENTER_Y = TUNING.move.capsuleHeight / 2 + CAPSULE_SKIN;
