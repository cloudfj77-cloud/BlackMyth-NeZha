/**
 * Pure hover-locomotion math (no ECS), unit-tested in __tests__/motion.test.ts.
 * Position must follow the hands: velocity ramps linearly to the requested
 * velocity (full speed in `accelTime`, stop in `decelTime`); the "floaty"
 * feeling comes only from lean and sash drag, never from position lag.
 */
export interface MoveTuning {
  readonly walkSpeed: number;
  readonly sprintSpeed: number;
  readonly accelTime: number;
  readonly decelTime: number;
  readonly turnRate: number;
  readonly sprintHoldThreshold: number;
  readonly leanWalk: number;
  readonly leanSprint: number;
  readonly leanBlendTime: number;
}

export interface Velocity {
  readonly x: number;
  readonly z: number;
}

/**
 * Velocity ramp. Accelerating: constant rate `topSpeed / accelTime`. Braking (no
 * input): constant rate `speedAtRelease / decelTime`, latched when braking starts,
 * so walk and sprint both stop in exactly `decelTime` (walk slides ~0.375 m).
 */
export function createVelocityStepper() {
  let brakeRate = 0;
  return {
    step(current: Velocity, target: Velocity, topSpeed: number, tuning: MoveTuning, dt: number): Velocity {
      const targetSpeed = Math.hypot(target.x, target.z);
      const braking = targetSpeed < 1e-6;
      if (!braking) brakeRate = 0;
      else if (brakeRate === 0) brakeRate = Math.hypot(current.x, current.z) / Math.max(1e-3, tuning.decelTime);
      const rate = braking ? brakeRate : Math.max(topSpeed, targetSpeed) / Math.max(1e-3, tuning.accelTime);
      const dx = target.x - current.x, dz = target.z - current.z;
      const gap = Math.hypot(dx, dz);
      const step = rate * dt;
      if (gap <= step + 1e-9) {
        if (braking) brakeRate = 0;
        return { x: target.x, z: target.z };
      }
      return { x: current.x + (dx / gap) * step, z: current.z + (dz / gap) * step };
    },
    reset(): void {
      brakeRate = 0;
    },
  };
}

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Turn `current` toward `desired` at most `rateDeg` degrees per second. */
export function turnToward(current: number, desired: number, rateDeg: number, dt: number): number {
  const diff = wrapAngle(desired - current);
  const max = (rateDeg * Math.PI * dt) / 180;
  return wrapAngle(current + Math.sign(diff) * Math.min(Math.abs(diff), max));
}

/** Forward lean (degrees) for a horizontal speed: 0 → leanWalk at walk speed → leanSprint at sprint speed. */
export function leanForSpeed(speed: number, tuning: MoveTuning): number {
  if (speed <= tuning.walkSpeed) return tuning.leanWalk * Math.max(0, speed) / Math.max(1e-3, tuning.walkSpeed);
  const t = Math.min(1, (speed - tuning.walkSpeed) / Math.max(1e-3, tuning.sprintSpeed - tuning.walkSpeed));
  return tuning.leanWalk + (tuning.leanSprint - tuning.leanWalk) * t;
}

/**
 * Shift: held past the threshold = sprint; released before it = a tap
 * (reserved for the M2 Wind-Fire Step, counted only).
 */
export function createShiftGesture() {
  let held = 0;
  let down = false;
  return {
    update(isDown: boolean, dt: number, threshold: number): { readonly sprint: boolean; readonly tap: boolean } {
      let tap = false;
      if (isDown) held = down ? held + dt : 0;
      else if (down && held < threshold) tap = true;
      down = isDown;
      if (!isDown) held = 0;
      return { sprint: isDown && held >= threshold, tap };
    },
    reset(): void {
      held = 0;
      down = false;
    },
  };
}
