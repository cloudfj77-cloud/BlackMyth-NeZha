/**
 * Seaweed placement (pure, deterministic): three groups with independent counts,
 * planted in clumps. Canyon: along both reef walls, leaving ≥ 1.5 m clear each side
 * of the centre line. Edge: the dragon band floor 20.6–25.4 m, not at the canyon mouth.
 * Far: trench terraces. Nothing within 2 m of a pillar (pillar QA probes).
 */
import { ARENA, CANYON, canyonCenterX, canyonHalfWidth, PILLARS, seeded, TRENCH } from '../shared/layout.ts';

export type SeaweedGroup = 'canyon' | 'edge' | 'far';
export interface Blade {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly height: number;
  readonly yaw: number;
  readonly lean: number;
}
export interface Clump {
  readonly group: SeaweedGroup;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blades: Blade[];
}

const DEG = Math.PI / 180;
const nearPillar = (x: number, z: number) => PILLARS.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius + 2);

function candidate(group: SeaweedGroup, random: () => number): { x: number; y: number; z: number } | undefined {
  if (group === 'canyon') {
    const z = CANYON.zStart + 1 + random() * (CANYON.zEnd - CANYON.zStart - 2);
    const half = canyonHalfWidth(z);
    const side = random() < 0.5 ? -1 : 1;
    const inner = Math.max(1.5, half - 1.3);
    const offset = inner + random() * Math.max(0, half - 0.25 - inner);
    return { x: canyonCenterX(z) + side * offset, y: 0, z };
  }
  if (group === 'edge') {
    // M3: the band floor between the vortex and the water wall (static seabed), not the rotating vortex.
    const angle = random() * Math.PI * 2;
    const fromEntrance = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
    if (fromEntrance < (ARENA.entranceHalfAngleDeg + 6) * DEG) return undefined;
    const radius = ARENA.seaweedInnerRadius + random() * (ARENA.seaweedOuterRadius - ARENA.seaweedInnerRadius);
    return { x: Math.sin(angle) * radius, y: 0, z: Math.cos(angle) * radius };
  }
  const angle = random() * Math.PI * 2;
  if (Math.cos(angle) > 0.85) return undefined;
  const radius = TRENCH.radius - 2 + random() * 3;
  return { x: Math.sin(angle) * radius, y: TRENCH.terraceY, z: Math.cos(angle) * radius };
}

export function placeSeaweed(group: SeaweedGroup, count: number, maxHeight: number): Clump[] {
  const random = seeded(group === 'canyon' ? 101 : group === 'edge' ? 202 : 303);
  const clumps: Clump[] = [];
  let left = Math.max(0, Math.round(count));
  let guard = 0;
  while (left > 0 && guard < 10000) {
    guard += 1;
    const at = candidate(group, random);
    if (!at || nearPillar(at.x, at.z)) continue;
    const size = Math.min(left, 8 + Math.floor(random() * 8));
    const blades: Blade[] = [];
    for (let i = 0; i < size; i += 1) {
      const r = Math.sqrt(random()) * 0.45;
      const a = random() * Math.PI * 2;
      const tall = group === 'far' ? 1.6 + random() * 1.4 : maxHeight * (0.55 + random() * 0.45);
      blades.push({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r, height: tall, yaw: random() * Math.PI * 2, lean: (random() - 0.5) * 0.25 });
    }
    clumps.push({ group, ...at, blades });
    left -= size;
  }
  return clumps;
}

/** Shared current: every clump sways the same way; phase drifts slowly with position (rolling wave). */
export function swayAngle(time: number, hz: number, x: number, z: number, amplitude = 0.16): number {
  return amplitude * Math.sin(2 * Math.PI * hz * time - 0.05 * (x * 0.6 + z * 0.8));
}
