// gta6-twitch-ccu-forecast-01 entry V07: aligned-jump kernel (spread x0.75)
// blended with a local-linear median.
//
// Idea: launch-day Twitch curves share a shape, but each game's morning
// jump lands on a different hour. Part A aligns every comparable launch
// curve so its biggest morning jump (hours 4..10) sits at hour 5, then
// takes a Gaussian-kernel weighted quantile (bandwidth 0.5 in log space,
// weight by closeness of the aligned hour-1 print to this case's hour-1
// print) of the aligned log-ratios, with the spread shrunk by 0.75.
// Part B is a per-hour local-linear regression of ln(viewers_h) on
// ln(viewers_1) over the unaligned curves. The final median is the
// geometric mean of the two medians; the final spread is Part A's
// (already shrunk) spread around that median.
//
// Node 22, standard library only, no network, deterministic.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const HOURS = Array.from({ length: 23 }, (_, i) => i + 2); // 2..24
const SIGMA_KERNEL = 0.5; // Gaussian kernel bandwidth in log space
const SPREAD_SHRINK = 0.75; // Part A spread multiplier
const MAX_VIEWERS = 1e9;

interface HourlyRow {
  from: string;
  viewers: number;
}

interface Comparable {
  day_start: string;
  hourly: HourlyRow[];
}

interface Case {
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

const clampPositive = (x: number): number => {
  if (!Number.isFinite(x) || x <= 0) return 1;
  return Math.min(x, MAX_VIEWERS);
};

/** Weighted quantile of values with weights (both same length, sorted by value). */
function weightedQuantile(pairs: Array<[number, number]>, tau: number): number {
  const sorted = pairs.slice().sort((a, b) => a[0] - b[0]);
  let total = 0;
  for (const [, w] of sorted) total += w;
  if (total <= 0 || sorted.length === 0) return sorted.length ? sorted[0][0] : 0;
  const target = tau * total;
  let cum = 0;
  for (const [v, w] of sorted) {
    cum += w;
    if (cum >= target) return v;
  }
  return sorted[sorted.length - 1][0];
}

/** Release-day curve of one comparable: hour (1..24) -> viewers (>0 only). */
function releaseCurve(comp: Comparable): Map<number, number> {
  const start = Date.parse(comp.day_start);
  const curve = new Map<number, number>();
  if (!Number.isFinite(start)) return curve;
  for (const row of comp.hourly ?? []) {
    const t = Date.parse(row.from);
    if (!Number.isFinite(t)) continue;
    const h = Math.round((t - start) / 3_600_000) + 1;
    if (h < 1 || h > 24) continue;
    const v = Number(row.viewers);
    if (Number.isFinite(v) && v > 0) curve.set(h, v);
  }
  return curve;
}

/** Hour of the biggest morning jump (hours 4..10), default 5. */
function jumpHour(curve: Map<number, number>): number {
  let bestHour = 5;
  let bestJump = -Infinity;
  for (let h = 4; h <= 10; h++) {
    const prev = curve.get(h - 1);
    const cur = curve.get(h);
    if (prev === undefined || cur === undefined || prev <= 0 || cur <= 0) continue;
    const jump = Math.log(cur / prev);
    if (jump > bestJump) {
      bestJump = jump;
      bestHour = h;
    }
  }
  return bestHour;
}

function forecastCase(c: Case): Array<{ hour: number; q: number[] }> {
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error('case has no hour-1 print');
  const p1 = Math.max(1, first.viewers);
  const lnP1 = Math.log(p1);

  // Keep comparables with an hour-1 print and >= 12 hours of release-day data.
  interface Prepared {
    curve: Map<number, number>; // unaligned release-day curve
    aligned: Map<number, number>; // jump-aligned curve
    v1Aligned: number;
    weight: number;
  }
  const comps: Prepared[] = [];
  for (const comp of c.comparables ?? []) {
    const curve = releaseCurve(comp);
    if (!curve.has(1) || curve.size < 12) continue;
    const shift = 5 - jumpHour(curve);
    const aligned = new Map<number, number>();
    for (const [h, v] of curve) {
      const ha = h + shift;
      if (ha >= 1 && ha <= 24 && !aligned.has(ha)) aligned.set(ha, v);
    }
    const v1a = aligned.get(1);
    if (v1a === undefined || v1a <= 0) continue;
    const d = lnP1 - Math.log(v1a);
    const weight = Math.exp(-(d * d) / (2 * SIGMA_KERNEL * SIGMA_KERNEL));
    comps.push({ curve, aligned, v1Aligned: v1a, weight });
  }

  const rows: Array<{ hour: number; q: number[] }> = [];
  for (const h of HOURS) {
    // ---- Part A: kernel-weighted quantiles of aligned log-ratios ----
    let qA: number[] = [];
    const pairs: Array<[number, number]> = [];
    for (const comp of comps) {
      const v = comp.aligned.get(h);
      if (v !== undefined && v > 0) pairs.push([Math.log(v / comp.v1Aligned), comp.weight]);
    }
    if (pairs.length > 0) {
      qA = LEVELS.map((tau) => p1 * Math.exp(weightedQuantile(pairs, tau)));
    } else {
      // No aligned observation for this hour: fall back to unaligned ratios.
      const fallback: Array<[number, number]> = [];
      for (const comp of comps) {
        const v = comp.curve.get(h);
        const v1 = comp.curve.get(1);
        if (v !== undefined && v1 !== undefined && v > 0 && v1 > 0) {
          fallback.push([Math.log(v / v1), comp.weight]);
        }
      }
      qA = fallback.length > 0
        ? LEVELS.map((tau) => p1 * Math.exp(weightedQuantile(fallback, tau)))
        : LEVELS.map(() => p1);
    }
    const medianA = qA[2];
    // Narrow the spread by 0.75 around the median.
    const qAShrunk = qA.map((q) => medianA * Math.exp(Math.log(clampPositive(q) / medianA) * SPREAD_SHRINK));

    // ---- Part B: per-hour OLS of ln(v_h) on ln(v1), unaligned ----
    let medianB = medianA;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const comp of comps) {
      const v1 = comp.curve.get(1);
      const v = comp.curve.get(h);
      if (v1 !== undefined && v !== undefined && v1 > 0 && v > 0) {
        xs.push(Math.log(v1));
        ys.push(Math.log(v));
      }
    }
    if (xs.length >= 2) {
      const n = xs.length;
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      let sxx = 0;
      let sxy = 0;
      for (let i = 0; i < n; i++) {
        sxx += (xs[i] - mx) * (xs[i] - mx);
        sxy += (xs[i] - mx) * (ys[i] - my);
      }
      if (sxx > 1e-12) {
        const b = sxy / sxx;
        const a = my - b * mx;
        const pred = a + b * lnP1;
        if (Number.isFinite(pred)) medianB = Math.exp(pred);
      } else {
        // No spread in ln(v1): use the geometric mean ratio.
        const meanLogRatio = ys.reduce((acc, y, i) => acc + (y - xs[i]), 0) / n;
        medianB = p1 * Math.exp(meanLogRatio);
      }
    } else if (xs.length === 1) {
      medianB = p1 * Math.exp(ys[0] - xs[0]);
    }
    medianB = clampPositive(medianB);
    // Guard against extreme OLS extrapolation when p1 sits far outside
    // the comparables' hour-1 range: keep the regression median within
    // a factor exp(2) of the kernel median. On the practice cases p1 is
    // inside the range, so this guard does not move any forecast there.
    const logRatioB = Math.log(medianB / clampPositive(medianA));
    if (logRatioB > 2) medianB = clampPositive(medianA) * Math.exp(2);
    else if (logRatioB < -2) medianB = clampPositive(medianA) * Math.exp(-2);

    // ---- Combine: geometric-mean median, Part A (shrunk) spread ----
    const medianFinal = Math.sqrt(clampPositive(medianA) * medianB);
    const qs = qAShrunk.map((q) => medianFinal * Math.exp(Math.log(clampPositive(q) / medianA)));
    // Enforce finite, positive, <= 1e9, non-decreasing, rounded to 2 decimals.
    const clean: number[] = [];
    let prev = 0;
    for (const q of qs) {
      let v = round2(clampPositive(q));
      if (v < prev) v = prev;
      if (v <= 0) v = prev > 0 ? prev : 1;
      clean.push(v);
      prev = v;
    }
    rows.push({ hour: h, q: clean });
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  const hours = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
