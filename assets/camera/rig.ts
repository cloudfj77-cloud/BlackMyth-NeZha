/**
 * Right-shoulder camera rig math (pure; tested in __tests__/camera-rig.test.ts).
 * Conventions follow third-person.ts: yaw 0 looks toward -Z, camera-right is +X,
 * positive pitch puts the camera above the focus (looking down).
 */
export type V3 = readonly [number, number, number];

export interface RigTuning {
  readonly shoulderOffset: number;
  readonly minDistance: number;
  readonly collisionMargin: number;
  readonly wallLiftMax: number;
  readonly returnDelay: number;
  readonly returnTime: number;
}

/** Unit direction from the focus toward the orbiting camera. */
export function orbitDirection(yaw: number, pitch: number): V3 {
  const horizontal = Math.cos(pitch);
  return [-Math.sin(yaw) * horizontal, Math.sin(pitch), Math.cos(yaw) * horizontal];
}

export function cameraRight(yaw: number): V3 {
  return [Math.cos(yaw), 0, Math.sin(yaw)];
}

/** Where the camera wants to be with no obstruction: behind the focus, offset over the right shoulder. */
export function desiredBoom(focus: V3, yaw: number, pitch: number, distance: number, shoulder: number): { readonly unit: V3; readonly length: number } {
  const dir = orbitDirection(yaw, pitch);
  const right = cameraRight(yaw);
  const offset: V3 = [right[0] * shoulder + dir[0] * distance, dir[1] * distance, right[2] * shoulder + dir[2] * distance];
  const length = Math.hypot(offset[0], offset[1], offset[2]);
  return { unit: [offset[0] / length, offset[1] / length, offset[2] / length], length };
}

/** Allowed boom length along the probe line: in front of the nearest hit by `margin`, never past the desired length. */
export function boomLimit(desired: number, hits: readonly (number | undefined)[], margin: number): { readonly limit: number; readonly blocked: boolean } {
  let limit = desired;
  for (const hit of hits) if (hit !== undefined) limit = Math.min(limit, hit - margin);
  return { limit: Math.max(0, limit), blocked: limit < desired - 1e-4 };
}

/**
 * Boom length state: pulls in instantly (no frame may show through a wall),
 * waits `returnDelay`, then eases back out (≈98 % after `returnTime`).
 */
export function createBoom(initial: number) {
  let length = initial;
  let clearFor = 0;
  return {
    step(limit: number, tuning: RigTuning, dt: number): number {
      if (limit < length) {
        length = limit;
        clearFor = 0;
      } else {
        clearFor += dt;
        if (clearFor >= tuning.returnDelay) length += (limit - length) * (1 - Math.exp((-4 * dt) / Math.max(0.05, tuning.returnTime)));
      }
      return length;
    },
    get length() {
      return length;
    },
  };
}

/**
 * When the wall leaves less than `minDistance` behind Nezha, raise the camera up
 * the wall (at most `wallLiftMax`, further capped by `ceiling`) so it stays at
 * least `minDistance` from the focus and looks down on him instead of entering
 * his model. Returns the vertical lift (0 when the boom is long enough).
 */
export function wallLift(boom: number, tuning: RigTuning, ceiling = Infinity): number {
  if (boom >= tuning.minDistance) return 0;
  return Math.max(0, Math.min(tuning.wallLiftMax, ceiling, Math.sqrt(tuning.minDistance ** 2 - boom ** 2)));
}
