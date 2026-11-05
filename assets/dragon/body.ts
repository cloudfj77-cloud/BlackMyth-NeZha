/**
 * The dragon's body as one spine (pure; tested in __tests__/dragon.test.ts).
 * 41 points, 0.45 m apart (18 m), head = point 0. The same points drive the rendered
 * capsules, the hurt capsules and the attack warnings, so they can never disagree.
 * Design: design/meetings/2026-11-05-dragon-redesign.md, design/milestones/M3-dragon.md.
 */
export type P3 = [number, number, number];
export interface V2 {
  readonly x: number;
  readonly z: number;
}

export const POINTS = 41;
export const SPACING = 0.45;
/** Last point of the front 11 m (lock point, front hurt capsules). */
export const FRONT_LAST = 24;
/** Waist: pivot of the tail lash (the tail beyond reaches ~7 m). */
export const WAIST = 25;
/** Swimming centre height: underside 3.85 m at the chest, so passing over Nezha stays ≥ 3.5 m. */
export const SWIM_Y = 4.6;
/** Nezha's hurt capsule top (it stays on the floor, 0–1.9 m): a body part below this can hit him. */
export const HURT_TOP = 1.9;
/** Nezha can only hit a dragon part whose underside is at or below this height. */
export const HITTABLE_UNDERSIDE = 2.5;
export const WAVE_LENGTH = 9;
export const WAVE_HZ = 0.4;
export const STEP = 1 / 60;

/** Body radius per point: head 0.6, chest 0.75 (Ø 1.5 m), tapering to 0.15 at the tail tip. */
export function radius(i: number): number {
  if (i <= 2) return 0.6;
  if (i <= 8) return 0.75;
  return 0.75 + (0.15 - 0.75) * ((i - 8) / (POINTS - 1 - 8));
}

export const clone = (points: readonly P3[]): P3[] => points.map((p) => [p[0], p[1], p[2]]);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
export const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Direction convention on the floor: angle 0 = +Z, positive toward +X. */
export const dirOf = (angle: number): V2 => ({ x: Math.sin(angle), z: Math.cos(angle) });
export const angleOf = (x: number, z: number) => Math.atan2(x, z);

/** A straight body lying along -dir behind `head`, at swim height. */
export function straightBody(head: V2, dir: V2, y = SWIM_Y): P3[] {
  return Array.from({ length: POINTS }, (_, i): P3 => [head.x - dir.x * SPACING * i, y, head.z - dir.z * SPACING * i]);
}

/** Follow-the-leader: each point keeps SPACING to its predecessor (snake trail). */
export function followChain(points: P3[], head: P3): void {
  points[0] = [head[0], head[1], head[2]];
  for (let i = 1; i < POINTS; i += 1) {
    const a = points[i - 1]!, b = points[i]!;
    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    let len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) {
      dx = 0; dy = 0; dz = 1; len = 1;
    }
    const k = SPACING / len;
    points[i] = [a[0] + dx * k, a[1] + dy * k, a[2] + dz * k];
  }
}

/** Horizontal travelling wave (λ 9 m, amplitude 0.15 m at the neck → 0.6 m at the tail) across the body. */
export function withWave(points: readonly P3[], phase: number, amp: number): P3[] {
  if (amp <= 1e-6) return clone(points);
  return points.map((p, i): P3 => {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(POINTS - 1, i + 1)]!;
    let tx = a[0] - b[0], tz = a[2] - b[2];
    const n = Math.hypot(tx, tz) || 1;
    tx /= n;
    tz /= n;
    const A = (0.15 + 0.45 * (i / (POINTS - 1))) * amp;
    const off = A * Math.sin((2 * Math.PI * i * SPACING) / WAVE_LENGTH - phase);
    return [p[0] - tz * off, p[1], p[2] + tx * off];
  });
}

export interface HurtCapsule {
  readonly index: number;
  readonly from: number;
  readonly to: number;
  readonly tail: boolean;
  readonly a: P3;
  readonly b: P3;
  readonly r: number;
  /** Lowest point of the capsule (underside). */
  readonly bottom: number;
}

/** Hurt capsules: front 11 m in 6 pieces (points 0–24), tail in 4 pieces (24–40). */
export function hurtCapsules(points: readonly P3[]): HurtCapsule[] {
  const spans: [number, number, boolean][] = [];
  for (let k = 0; k < 6; k += 1) spans.push([k * 4, k * 4 + 4, false]);
  for (let k = 0; k < 4; k += 1) spans.push([FRONT_LAST + k * 4, FRONT_LAST + k * 4 + 4, true]);
  return spans.map(([from, to, tail], index) => {
    let bottom = Infinity, r = 0;
    for (let i = from; i <= to; i += 1) {
      bottom = Math.min(bottom, points[i]![1] - radius(i));
      r = Math.max(r, radius(i));
    }
    return { index, from, to, tail, a: points[from]!, b: points[to]!, r, bottom };
  });
}

/** Closest point on the horizontal projection of segment a–b to (x, z). */
export function closestOnSegment(a: P3, b: P3, x: number, z: number): V2 {
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const len2 = dx * dx + dz * dz;
  const t = len2 < 1e-9 ? 0 : clamp01(((x - a[0]) * dx + (z - a[2]) * dz) / len2);
  return { x: a[0] + dx * t, z: a[2] + dz * t };
}

/** Closest point on the front 11 m centre line (lock point / orbit pivot) and its height. */
export function frontNearest(points: readonly P3[], x: number, z: number): { readonly x: number; readonly z: number; readonly y: number; readonly i: number } {
  let best = { x: points[0]![0], z: points[0]![2], y: points[0]![1], i: 0 }, bestD = Infinity;
  for (let i = 0; i < FRONT_LAST; i += 1) {
    const a = points[i]!, b = points[i + 1]!;
    const c = closestOnSegment(a, b, x, z);
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bestD) {
      bestD = d;
      const t = Math.hypot(c.x - a[0], c.z - a[2]) / (Math.hypot(b[0] - a[0], b[2] - a[2]) || 1);
      best = { x: c.x, z: c.z, y: lerp(a[1], b[1], t), i };
    }
  }
  return best;
}

// --- Attacks ------------------------------------------------------------------------------------

export type AttackKind = 'bite' | 'lash' | 'charge';

/** Step numbers from the start of the telegraph: windup end / hold end / hit frame (shrink end). */
export const ATTACKS = Object.freeze({
  bite: { windup: 12, hold: 36, hit: 42, damage: 15, knock: 0, parts: [0, 6] as const },
  lash: { windup: 18, hold: 46, hit: 54, damage: 18, knock: 3, parts: [WAIST, POINTS - 1] as const },
  charge: { windup: 14, hold: 42, hit: 48, damage: 20, knock: 0, parts: [0, 2] as const },
});
/** Recovery after the hit frame (part of the opening). */
export const RECOVER = 12;
/** Opening: steps from the hit frame (includes the recovery) during which the dragon can be punished. */
export const OPENING = 72;
export const CHARGE_MAX = 16;
export const CHARGE_MIN = 8;
/** The charge stops with the head at this radius (inside the vortex). */
export const CHARGE_STOP_RADIUS = 19;

export interface Attack {
  readonly kind: AttackKind;
  /** Chain points (no wave) when the telegraph started. */
  readonly snapshot: readonly P3[];
  /** Wave phase at the start; it freezes 6 steps in (shape kept, never reset). */
  readonly phase0: number;
  readonly amp0: number;
  /** Head ground point and locked direction toward Nezha (bite / charge). */
  readonly origin: V2;
  readonly dir: V2;
  /** Charge travel. */
  readonly length: number;
  /** Lash: waist pivot and the sweep angles. */
  readonly pivot: V2;
  readonly theta0: number;
  readonly theta1: number;
}

/** Distance along `dir` from `p` until the circle of radius R is reached (∞ if never). */
export function distanceToRadius(p: V2, dir: V2, R: number): number {
  const b = p.x * dir.x + p.z * dir.z;
  const c = p.x * p.x + p.z * p.z - R * R;
  const disc = b * b - c;
  if (disc < 0) return 0;
  return Math.max(0, -b + Math.sqrt(disc));
}

export function chargeLength(head: V2, dir: V2): number {
  return Math.min(CHARGE_MAX, distanceToRadius(head, dir, CHARGE_STOP_RADIUS));
}

export function createAttack(kind: AttackKind, chain: readonly P3[], phase: number, amp: number, nezha: V2): Attack {
  const head = { x: chain[0]![0], z: chain[0]![2] };
  let dx = nezha.x - head.x, dz = nezha.z - head.z;
  const n = Math.hypot(dx, dz) || 1;
  dx /= n;
  dz /= n;
  const dir = { x: dx, z: dz };
  const pivot = { x: chain[WAIST]![0], z: chain[WAIST]![2] };
  const aim = angleOf(nezha.x - pivot.x, nezha.z - pivot.z);
  const tailAngle = angleOf(chain[POINTS - 1]![0] - pivot.x, chain[POINTS - 1]![2] - pivot.z);
  const fromLeft = wrap(tailAngle - aim) < 0;
  const half = (70 * Math.PI) / 180;
  return {
    kind,
    snapshot: clone(chain),
    phase0: phase,
    amp0: amp,
    origin: head,
    dir,
    length: kind === 'charge' ? chargeLength(head, dir) : 0,
    pivot,
    theta0: fromLeft ? aim - half : aim + half,
    theta1: fromLeft ? aim + half : aim - half,
  };
}

const local = (att: Attack, fwd: number, lat: number, y: number): P3 => {
  // Right of the locked direction: (dir.z, -dir.x) with angle 0 = +Z, positive toward +X.
  const rx = att.dir.z, rz = -att.dir.x;
  return [att.origin.x + att.dir.x * fwd + rx * lat, y, att.origin.z + att.dir.z * fwd + rz * lat];
};

function biteCoiled(att: Attack): P3[] {
  return Array.from({ length: POINTS }, (_, i) => {
    if (i === 0) return local(att, -1.5, 0, 5.0);
    if (i <= 6) return local(att, -1.5 - 0.36 * i, 0.5 * Math.sin((Math.PI * i) / 3), 5.0 - 1.6 * (i / 6));
    return local(att, -1.5 - 2.16 - SPACING * (i - 6), 0, 3.4 + 1.2 * Math.min(1, (i - 6) / 8));
  });
}
function biteLunged(att: Attack): P3[] {
  return Array.from({ length: POINTS }, (_, i) => local(att, 7.5 - SPACING * i, 0, 1.6 + 3.0 * smooth(i / 14)));
}
function chargeStraight(att: Attack, travel: number): P3[] {
  return Array.from({ length: POINTS }, (_, i) => local(att, travel - SPACING * i, 0, i === 0 ? 1.2 : radius(i) + 0.3));
}
function lashPose(att: Attack, theta: number, tailY: number): P3[] {
  const s = att.snapshot;
  return Array.from({ length: POINTS }, (_, i): P3 => {
    if (i < WAIST) {
      const p = s[i]!;
      if (i < 18) return [p[0], p[1], p[2]];
      // Lower toward the tail root, but never low enough to hit (only the tail does).
      const floor = HURT_TOP + radius(i) + 0.05;
      return [p[0], lerp(p[1], Math.max(tailY, floor), (i - 17) / 8), p[2]];
    }
    const d = dirOf(theta);
    const r = SPACING * (i - WAIST);
    return [att.pivot.x + d.x * r, tailY, att.pivot.z + d.z * r];
  });
}

/** Attack target pose (no wave) at step k (fractional) up to the hit frame. */
function target(att: Attack, k: number): P3[] {
  const A = ATTACKS[att.kind];
  const t = clamp01((k - A.hold) / (A.hit - A.hold));
  switch (att.kind) {
    case 'bite': {
      const c = biteCoiled(att);
      if (k <= A.hold) return c;
      const l = biteLunged(att);
      const ty = easeOut(Math.min(1, t * 2.5)), tf = t ** 1.5;
      return c.map((p, i): P3 => {
        const q = l[i]!;
        return [lerp(p[0], q[0], tf), lerp(p[1], q[1], ty), lerp(p[2], q[2], tf)];
      });
    }
    case 'charge':
      return chargeStraight(att, k <= A.hold ? 0 : att.length * t * t);
    case 'lash': {
      if (k <= A.hold) return lashPose(att, att.theta0, 3.0);
      const tailY = lerp(3.0, 1.9, smooth((k - A.hold) / 2));
      return lashPose(att, att.theta0 + (att.theta1 - att.theta0) * t ** 3, tailY);
    }
  }
}

/** Opening pose: head 2.2 m, front 11 m lying on the floor (underside ≤ 0.5 m), tail as it ended. */
export function openingPose(end: readonly P3[]): P3[] {
  return end.map((p, i): P3 => {
    let y: number;
    if (i === 0) y = 2.2;
    else if (i === 1) y = 1.5;
    else if (i === 2) y = 1.0;
    else if (i <= FRONT_LAST) y = radius(i) + 0.1;
    else if (i <= 30) y = lerp(radius(i) + 0.1, p[1], (i - FRONT_LAST) / 6);
    else y = p[1];
    return [p[0], y, p[2]];
  });
}

const blend = (a: readonly P3[], b: readonly P3[], w: number): P3[] => a.map((p, i): P3 => {
  const q = b[i]!;
  return [lerp(p[0], q[0], w), lerp(p[1], q[1], w), lerp(p[2], q[2], w)];
});

export interface AttackFrame {
  readonly points: P3[];
  /** The same pose before the travelling wave is added (the swim chain resumes from it). */
  readonly raw: P3[];
  readonly phase: number;
  readonly amp: number;
}

/**
 * The attack from telegraph start (k = 0) to the end of the opening (k = hit + OPENING), with wave.
 * Windup gathers into the pose with an 8 % overshoot that settles before the hold (the hold never
 * moves); the strike plays the attack; recovery slides into the opening pose.
 */
export function attackFrame(att: Attack, k: number): AttackFrame {
  const A = ATTACKS[att.kind];
  const phase = att.phase0 + Math.min(k, 6) * 2 * Math.PI * WAVE_HZ * STEP;
  let points: P3[];
  let amp = att.amp0;
  if (k <= A.windup) {
    const u = clamp01(k / A.windup);
    const w = easeOut(u) + 0.08 * Math.sin(Math.PI * u);
    points = blend(att.snapshot, target(att, A.windup), w);
  } else if (k <= A.hit) points = target(att, k);
  else {
    const end = target(att, A.hit);
    points = blend(end, openingPose(end), smooth((k - A.hit) / RECOVER));
  }
  // The wave keeps its shape (phase frozen) but calms while the body takes the attack pose, so the
  // swept edges stay straight: charge 10 %, bite 15 %, lash 3 % (the tail must sweep as a straight blade); the opening breathes at 30 %.
  const calm = att.kind === 'charge' ? 0.1 : att.kind === 'lash' ? 0.03 : 0.15;
  amp = lerp(att.amp0, calm, clamp01(k / A.windup));
  if (k > A.hit) amp = lerp(calm, 0.3, clamp01((k - A.hit) / RECOVER));
  return { points: withWave(points, phase, amp), raw: points, phase, amp };
}

export interface Disc {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

/** Body discs that can hurt Nezha (underside below his hurt top) while the attack strikes. */
export function damagingDiscs(att: Attack, substeps = att.kind === 'lash' ? 24 : 4): Disc[] {
  // The lash tail tip moves fastest at the end of its sweep, so it is sampled more finely.
  const A = ATTACKS[att.kind];
  const [from, to] = A.parts;
  const out: Disc[] = [];
  for (let s = A.hold * substeps; s <= A.hit * substeps; s += 1) {
    const pts = attackFrame(att, s / substeps).points;
    // The body is continuous: sample each segment every ~0.15 m, not only at the 0.45 m points.
    for (let i = from; i <= to; i += 1) {
      for (let f = 0; f < (i < to ? 3 : 1); f += 1) {
        const a = pts[i]!, b = pts[Math.min(to, i + 1)]!, t = f / 3;
        const y = lerp(a[1], b[1], t), r = lerp(radius(i), radius(Math.min(to, i + 1)), t);
        if (y - r <= HURT_TOP && y + r >= 0) out.push({ x: lerp(a[0], b[0], t), z: lerp(a[2], b[2], t), r });
      }
    }
  }
  return out;
}

export type Polygon = readonly V2[];

/** Convex hull (counter-clockwise) of the discs: the warning shape = the damage area. */
export function discHull(discs: readonly Disc[], samples = 16): Polygon {
  const pts: V2[] = [];
  for (const d of discs) {
    for (let k = 0; k < samples; k += 1) {
      const a = (k / samples) * Math.PI * 2;
      pts.push({ x: d.x + Math.cos(a) * d.r, z: d.z + Math.sin(a) * d.r });
    }
  }
  pts.sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: V2, a: V2, b: V2) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: V2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: V2[] = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Signed distance from (x, z) to a convex CCW polygon (negative inside). */
export function polygonDistance(poly: Polygon, x: number, z: number): number {
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x, ez = b.z - a.z;
    if (ex * (z - a.z) - ez * (x - a.x) < 0) inside = false;
    const len2 = ex * ex + ez * ez || 1;
    const t = clamp01(((x - a.x) * ex + (z - a.z) * ez) / len2);
    best = Math.min(best, Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t)));
  }
  return inside ? -best : best;
}

/** At the hit frame, does a damaging part cross Nezha's body height band (1.2–2.6 m)? */
export function hitCrossesBand(att: Attack, lo = 1.2, hi = 2.6): boolean {
  const A = ATTACKS[att.kind];
  const pts = attackFrame(att, A.hit).points;
  for (let i = A.parts[0]; i <= A.parts[1]; i += 1) {
    const p = pts[i]!;
    if (p[1] - radius(i) <= hi && p[1] + radius(i) >= lo) return true;
  }
  return false;
}
