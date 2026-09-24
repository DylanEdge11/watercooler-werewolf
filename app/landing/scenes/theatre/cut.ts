/**
 * Scissor-cut geometry for the toy theatre. Every path is traced from a
 * polygon whose edges are subdivided and nudged sideways by a seeded PRNG, so
 * edges look hand-cut but are identical on server and client.
 */

export type Pt = [number, number];

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const q = (n: number) => Math.round(n * 10) / 10;

function area(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i += 1) {
    const u = p[i];
    const v = p[(i + 1) % p.length];
    a += u[0] * v[1] - v[0] * u[1];
  }
  return a;
}

export interface Cutter {
  /** Hand-cut outline of a polygon (clockwise-normalised). */
  cut: (p: Pt[], jitter?: number, step?: number) => string;
  /** Same outline wound the other way, for cutting holes with nonzero fill. */
  hole: (p: Pt[], jitter?: number, step?: number) => string;
  /** Seeded random in [a, b). */
  rr: (a: number, b: number) => number;
}

export function makeCutter(seed: number): Cutter {
  const R = mulberry32(seed);
  function trace(p: Pt[], j: number, step: number): string {
    let s = '';
    const n = p.length;
    for (let i = 0; i < n; i += 1) {
      const a = p[i];
      const b = p[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      const k = Math.max(1, Math.round(L / step));
      const nx = -dy / L;
      const ny = dx / L;
      for (let t = 0; t < k; t += 1) {
        let x = a[0] + (dx * t) / k;
        let y = a[1] + (dy * t) / k;
        if (t > 0) {
          const o = (R() - 0.5) * 2 * j;
          x += nx * o;
          y += ny * o;
        }
        s += `${s ? 'L' : 'M'}${q(x)} ${q(y)}`;
      }
    }
    return `${s}Z`;
  }
  const orient = (p: Pt[]) => (area(p) < 0 ? p.slice().reverse() : p);
  return {
    cut: (p, j = 0.7, step = 7) => trace(orient(p), j, step),
    hole: (p, j = 0.7, step = 7) => trace(orient(p).slice().reverse(), j, step),
    rr: (a, b) => a + (b - a) * R(),
  };
}

export function circ(cx: number, cy: number, r: number, n?: number, ry = r): Pt[] {
  const count = n ?? Math.max(10, Math.round(r * 1.2));
  const p: Pt[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * ry]);
  }
  return p;
}

export function box(x: number, y: number, w: number, h: number): Pt[] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/** Sample a function along x to build a ridge that closes down to `bottom`. */
export function ridge(fn: (x: number) => number, x0: number, x1: number, bottom: number, step = 8): Pt[] {
  const p: Pt[] = [];
  for (let x = x0; x <= x1 + 0.01; x += step) p.push([x, fn(x)]);
  p.push([x1, bottom], [x0, bottom]);
  return p;
}

/** A pine silhouette as a list of stacked tiers (each a polygon) plus trunk. */
export function pineTiers(cx: number, by: number, h: number, w: number, tiers = 4): Pt[][] {
  const out: Pt[][] = [];
  const trunk = h * 0.1;
  const crown = h - trunk;
  const st = crown / (tiers + 0.4);
  const tip = by - h;
  for (let i = 0; i < tiers; i += 1) {
    const top = tip + i * st;
    const bot = tip + (i + 1.4) * st;
    const half = (w / 2) * (0.3 + (0.7 * (i + 1)) / tiers);
    out.push([[cx, top], [cx + half, bot], [cx + half * 0.45, bot - st * 0.25], [cx, bot - st * 0.15], [cx - half * 0.45, bot - st * 0.25], [cx - half, bot]]);
  }
  const tw = Math.max(2, w * 0.06);
  out.push([[cx - tw, by], [cx - tw * 0.8, by - trunk - st * 0.5], [cx + tw * 0.8, by - trunk - st * 0.5], [cx + tw, by]]);
  return out;
}
