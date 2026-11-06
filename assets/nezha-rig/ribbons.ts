/**
 * Physical ribbons (ported from BlackMyth-NeZha v1.4.0 `Ribbon`, boss 11-06 batch 1): Verlet chains
 * pinned at one end (or both), pushed by wind, a flutter and a pull behind the body, with length
 * constraints; written as twisting, tapering strips. All strips share ONE mesh (one draw call).
 * Pure: positions in, vertex positions out (world space).
 */
export type V3 = [number, number, number];

export interface RibbonSpec {
  /** Points along the strip. */
  readonly n: number;
  readonly len: number;
  readonly width: number;
  readonly gravity: number;
  readonly drag: number;
  readonly flutter: number;
  readonly taper: number;
  readonly twist: number;
  readonly back: number;
  readonly lift: number;
  readonly seed: number;
}

export function ribbonSpec(o: Partial<RibbonSpec> & { n: number; len: number; width: number }, seed: number): RibbonSpec {
  return { gravity: -3.5, drag: 0.04, flutter: 5, taper: 0.5, twist: 0.8, back: 0, lift: 0, ...o, seed };
}

export class Ribbon {
  readonly p: V3[] = [];
  readonly q: V3[] = [];
  private inited = false;
  constructor(readonly spec: RibbonSpec) {
    for (let i = 0; i < spec.n; i += 1) {
      this.p.push([0, 0, 0]);
      this.q.push([0, 0, 0]);
    }
  }
  reset(pin: V3, pinB?: V3) {
    for (let i = 0; i < this.spec.n; i += 1) {
      const u = i / (this.spec.n - 1);
      // Both ends pinned (v1.4.0 混天绫 loop): start as a sagging arc between the pins.
      this.p[i] = pinB
        ? [pin[0] + (pinB[0] - pin[0]) * u, pin[1] + (pinB[1] - pin[1]) * u - Math.sin(u * Math.PI) * this.spec.len * 0.3, pin[2] + (pinB[2] - pin[2]) * u]
        : [pin[0], pin[1] - u * this.spec.len, pin[2]];
      this.q[i] = [...this.p[i]!];
    }
    this.inited = true;
  }
  /** Advance by dt (s) at time t; `back` is the direction behind the body (unit, horizontal). */
  update(dt: number, t: number, pin: V3, wind: V3, back: V3, floorY: number, pinB?: V3) {
    const s = this.spec;
    const d0 = this.p[0]!;
    if (!this.inited || Math.hypot(pin[0] - d0[0], pin[1] - d0[1], pin[2] - d0[2]) > 4) this.reset(pin, pinB);
    if (dt <= 0) return;
    const seg = s.len / (s.n - 1), steps = 3, h = Math.min(dt, 0.05) / steps;
    const last = pinB ? s.n - 1 : s.n;
    for (let st = 0; st < steps; st += 1) {
      for (let i = 1; i < last; i += 1) {
        const p = this.p[i]!, q = this.q[i]!;
        const vx = (p[0] - q[0]) * (1 - s.drag), vy = (p[1] - q[1]) * (1 - s.drag), vz = (p[2] - q[2]) * (1 - s.drag);
        this.q[i] = [p[0], p[1], p[2]];
        const ph = t * 6 + i * 0.55 + s.seed, k = i / s.n;
        const fx = wind[0] + back[0] * s.back * k + Math.sin(ph) * s.flutter * k;
        const fz = wind[2] + back[2] * s.back * k + Math.cos(ph * 0.83) * s.flutter * k;
        const fy = s.gravity + s.lift + Math.sin(ph * 1.3) * s.flutter * 0.6 * k;
        this.p[i] = [p[0] + vx + fx * h * h, p[1] + vy + fy * h * h, p[2] + vz + fz * h * h];
      }
      this.p[0] = [pin[0], pin[1], pin[2]];
      if (pinB) this.p[s.n - 1] = [pinB[0], pinB[1], pinB[2]];
      for (let it = 0; it < 4; it += 1) {
        for (let i = 0; i < s.n - 1; i += 1) {
          const a = this.p[i]!, b = this.p[i + 1]!;
          let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
          const l = Math.hypot(dx, dy, dz) || 1e-5, diff = (l - seg) / l;
          const fixA = i === 0, fixB = !!pinB && i + 1 === s.n - 1;
          const wa = fixA ? 0 : fixB ? 1 : 0.5, wb = fixB ? 0 : fixA ? 1 : 0.5;
          dx *= diff; dy *= diff; dz *= diff;
          a[0] += dx * wa; a[1] += dy * wa; a[2] += dz * wa;
          b[0] -= dx * wb; b[1] -= dy * wb; b[2] -= dz * wb;
        }
        for (let i = 1; i < last; i += 1) if (this.p[i]![1] < floorY + 0.04) this.p[i]![1] = floorY + 0.04;
      }
    }
  }
  /** Write the strip (2 vertices per point) into `out` from vertex `first`; returns the next vertex. */
  write(out: Float32Array, first: number, t: number): number {
    const s = this.spec;
    for (let i = 0; i < s.n; i += 1) {
      const a = this.p[Math.max(0, i - 1)]!, b = this.p[Math.min(s.n - 1, i + 1)]!;
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // side = tangent × up (or × X when vertical), then twisted about the tangent over time.
      let sx: number, sy: number, sz: number;
      if (Math.abs(ty) > 0.9) { sx = 0; sy = tz; sz = -ty; } else { sx = -tz; sy = 0; sz = tx; }
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx /= sl; sy /= sl; sz /= sl;
      const ang = Math.sin(t * 2.2 + i * 0.35 + s.seed) * s.twist;
      const c = Math.cos(ang), sn = Math.sin(ang);
      // Rodrigues: rotate side about tangent.
      const cx = ty * sz - tz * sy, cy = tz * sx - tx * sz, cz = tx * sy - ty * sx;
      const rx = sx * c + cx * sn, ry = sy * c + cy * sn, rz = sz * c + cz * sn;
      const w = s.width * (1 - s.taper * (i / (s.n - 1))) * 0.5;
      const p = this.p[i]!, v = (first + i * 2) * 3;
      out[v] = p[0] - rx * w; out[v + 1] = p[1] - ry * w; out[v + 2] = p[2] - rz * w;
      out[v + 3] = p[0] + rx * w; out[v + 4] = p[1] + ry * w; out[v + 5] = p[2] + rz * w;
    }
    return first + s.n * 2;
  }
}

/** Triangle indices of strips laid out one after another (2 vertices per point). */
export function stripIndices(counts: readonly number[]): Uint32Array {
  const idx: number[] = [];
  let base = 0;
  for (const n of counts) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    base += n * 2;
  }
  return new Uint32Array(idx);
}
