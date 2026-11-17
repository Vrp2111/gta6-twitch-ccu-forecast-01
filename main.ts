// gta6-v278 — GTA VI Twitch CCU hourly forecaster.
// Baseline: V269 replica + FASE 1 mechanism (pre-release history axis).
//
// FASE 1 (verified, see /tmp/v278/phase1*.py, resid.py, mech_test*.py, robust.py):
// Signal S = OLS slope of ln(viewers+1) over the case's own history_hourly in
// the 168h window before hour 1 (offsets -168..-1h, present points only).
// Practice S: p00 0.04471, p01 0.03652, p02 0.04267, p03 0.05731.
// S separates p01 (min) vs p03 (max) across the full 4-case range and
// correlates r=-0.931 with the V269 median log-residual at hours 10-15
// (needed shifts: p00 +0.022, p01 +0.407, p02 +0.022, p03 -0.232).
// Physical reading: S measures gradualness of the 7-day pre-launch ramp
// (high S = steady week-long build, low S = flat week then last-day
// explosion); a gradual build fades faster at midday, a sudden explosion
// sustains. The 24/48/72h windows of the same slope FAIL the residual test
// (slope72 OLS k worsens mean to 0.0916; ratio24/7d gains only 0.0032,
// sub-noise, carried by p03 alone); the 168h window is the one that passes.
// Robust to zero-handling: ln(v) positive-only r=-0.943, zero-filled grid
// r=-0.875, same p01-min/p03-max ordering in all variants.
// k from OLS of needed shift on (S - median S): -25.42 -> K = -25.4.
// Mechanism: at hours 10-15 only, logMed += K * (S - S_MED).
// Offline (same shifts applied to V269 outputs): mean 0.0798, max 0.1077.
// If history is missing/short (<24 points in window) the shift is 0.
// Node 24, TypeScript erasable syntax, stdlib only.
import * as fs from "node:fs";
import * as path from "node:path";

const LEVELS: number[] = [0.05, 0.25, 0.5, 0.75, 0.95];
const BW = 0.65;
const GRID_G1 = 1.4;
const GRID_G2 = 1.4;
const GRID_G3 = 1.0;
const GRID_G4 = 1.0;
const GRID_G5 = 1.0;
const F_SIZE_MID = 0.8;
const F_SIZE_END = 0.24;
const H3_MULT = 4.0;
const H5_MULT = 2.5;
const H12_MULT = 1.5;

// FASE 1 mechanism: pre-release 168h history log-slope signal.
const HIST_K = -25.4;
const HIST_SLOPE_MED = 0.04369068039084041; // practice median of S168
const HIST_MIN_POINTS = 24;

const BIAS: Record<number, number> = {
  2: -0.111, 3: -0.214, 4: -0.223, 5: 0.268, 6: 0.409, 7: 0.311,
  8: 0.156, 9: 0.05, 10: -0.132, 11: -0.191, 12: -0.355, 13: -0.255,
  14: -0.145, 15: -0.035, 16: -0.002, 17: 0.121, 18: 0.249, 19: 0.155,
  20: 0.107, 21: 0.12, 22: 0.098, 23: 0.028, 24: 0.034,
};

const TRIM4 = new Set([
  "Hollow Knight: Silksong",
  "HELLDIVERS 2",
  "Marvel Rivals",
  "Starfield",
]);

type Raw = Map<number, number>;

interface Comp {
  name: string;
  dayStart: string;
  raw: Raw;
  jump: number;
  aligned: Raw;
}

function rawSeries(comp: any): Raw {
  const t0 = Date.parse(comp.day_start);
  const raw: Raw = new Map();
  const hourly: any[] = Array.isArray(comp.hourly) ? comp.hourly : [];
  for (const row of hourly) {
    const v = Number(row.viewers);
    if (!(v > 0)) continue;
    const h = Math.round((Date.parse(row.from) - t0) / 3600000) + 1;
    if (h >= 1 && h <= 24) raw.set(h, v);
  }
  return raw;
}

function jumpHour(raw: Raw): number {
  let best = 5;
  let bestVal = -Infinity;
  for (let h = 4; h <= 10; h++) {
    const vh = raw.get(h);
    const vp = raw.get(h - 1);
    if (vh === undefined || vp === undefined) continue;
    const val = Math.log(vh / vp);
    if (val > bestVal) {
      bestVal = val;
      best = h;
    }
  }
  return best;
}

function align(raw: Raw, hj: number): Raw {
  const s = 5 - hj;
  const out: Raw = new Map();
  for (let h = 1; h <= 24; h++) {
    const v = raw.get(h - s);
    if (v !== undefined) out.set(h, v);
  }
  return out;
}

// Weighted quantile: smallest value whose cumulative weight share >= tau.
// Uniform fallback when total weight <= 1e-12; empty pool -> 0.
function wQuant(pairs: Array<[number, number]>, tau: number): number {
  if (pairs.length === 0) return 0;
  const sorted = pairs.slice().sort((a, b) => a[0] - b[0]);
  let total = 0;
  for (const [, w] of sorted) total += w;
  if (total <= 1e-12) {
    const xs = sorted.map((p) => p[0]);
    const idx = Math.min(xs.length - 1, Math.max(0, Math.ceil(tau * xs.length) - 1));
    return xs[idx];
  }
  let cum = 0;
  for (const [x, w] of sorted) {
    cum += w;
    if (cum / total >= tau) return x;
  }
  return sorted[sorted.length - 1][0];
}

// Loclin median: OLS of ln(v_h) on ln(v1) over raw kept curves.
function loclinMedian(kept: Comp[], h: number, lnP1: number): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of kept) {
    const v1 = c.raw.get(1);
    const vh = c.raw.get(h);
    if (v1 === undefined || vh === undefined) continue;
    xs.push(Math.log(v1));
    ys.push(Math.log(vh));
  }
  const n = xs.length;
  if (n === 0) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return my;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx <= 1e-12) return my;
  const b = sxy / sxx;
  const a = my - b * mx;
  return a + b * lnP1;
}

function baseWL(p1: number): number {
  if (p1 < 50000) return 0.85;
  if (p1 < 200000) return 0.5;
  return 0.4;
}

function gridFactor(h: number): number {
  if (h <= 5) return GRID_G1;
  if (h <= 9) return GRID_G2;
  if (h <= 15) return GRID_G3;
  if (h <= 19) return GRID_G4;
  return GRID_G5;
}

function fHour(h: number, tau: number): number {
  const inner = tau === 0.25 || tau === 0.5 || tau === 0.75;
  const inWindow = h >= 12 && h <= 18;
  if (inWindow) return inner ? 0.8 : 0.5;
  return inner ? 0.6 : 0.35;
}

function hourMult(h: number): number {
  if (h === 3) return H3_MULT;
  if (h === 5) return H5_MULT;
  if (h === 12) return H12_MULT;
  return 1.0;
}

// FASE 1: OLS slope of ln(viewers+1) over the case's own history_hourly in
// the 168 hours before hour 1. Offsets are hours relative to day_start;
// offset 0 is hour 1 itself and is excluded. Returns null when history is
// missing or has too few points (caller then applies no shift).
function historySlope168(c: any): number | null {
  const t0 = Date.parse(String(c.day_start ?? ""));
  if (!Number.isFinite(t0)) return null;
  const rows: any[] = Array.isArray(c.history_hourly) ? c.history_hourly : [];
  const pts: Array<[number, number]> = [];
  for (const row of rows) {
    const off = (Date.parse(row.from) - t0) / 3600000;
    if (!Number.isFinite(off) || off < -168 || off >= 0) continue;
    const v = Number(row.viewers);
    if (!Number.isFinite(v) || v < 0) continue;
    pts.push([off, Math.log(v + 1)]);
  }
  if (pts.length < HIST_MIN_POINTS) return null;
  pts.sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  let mx = 0;
  let my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) * (x - mx);
    sxy += (x - mx) * (y - my);
  }
  if (sxx <= 1e-12) return null;
  return sxy / sxx;
}

function forecastCase(c: any): { hours: Array<{ hour: number; q: number[] }> } {
  const known: any[] = Array.isArray(c.known) ? c.known : [];
  const k1 = known.find((r) => r.hour === 1);
  const p1 = Number(k1.viewers);
  const lnP1 = Math.log(p1);

  // Build comparable pool.
  const kept: Comp[] = [];
  const comps: any[] = Array.isArray(c.comparables) ? c.comparables : [];
  for (const comp of comps) {
    const ds = String(comp.day_start ?? "");
    if (ds.startsWith("2026-08-27")) continue; // GTA VI itself
    const name = String(comp.name ?? "").trim();
    if (TRIM4.has(name)) continue;
    const raw = rawSeries(comp);
    if (raw.size < 24) continue;
    const jump = jumpHour(raw);
    kept.push({ name, dayStart: ds, raw, jump, aligned: align(raw, jump) });
  }
  const kernelPool = kept.filter((cc) => cc.jump !== 4);

  const fSize = p1 >= 50000 && p1 < 200000 ? F_SIZE_MID : F_SIZE_END;
  // FASE 1 midday shift from the case's own pre-release history slope.
  const s168 = historySlope168(c);
  const histShift = s168 === null ? 0 : HIST_K * (s168 - HIST_SLOPE_MED);
  const hours: Array<{ hour: number; q: number[] }> = [];

  for (let h = 2; h <= 24; h++) {
    // Kernel quantiles at this hour.
    const pairs: Array<[number, number]> = [];
    for (const cc of kernelPool) {
      const a1 = cc.aligned.get(1);
      const ah = cc.aligned.get(h);
      if (a1 === undefined || ah === undefined) continue;
      const d = Math.log(a1) - lnP1;
      const w = Math.exp((-d * d) / (2 * BW * BW));
      pairs.push([Math.log(ah / a1), w]);
    }
    const kq: Record<number, number> = {};
    for (const tau of LEVELS) kq[tau] = wQuant(pairs, tau);
    const medA = kq[0.5];

    const medB = loclinMedian(kept, h, lnP1);

    let wL = baseWL(p1);
    if (h >= 10 && h <= 15) wL = Math.min(1.0, 1.5 * wL);
    wL = Math.min(1.0, wL * gridFactor(h));

    const logMed0 = lnP1 + (1 - wL) * medA + wL * (medB - lnP1);
    // FASE 1: shift the midday (10-15) level by the history-slope signal.
    const logMed = h >= 10 && h <= 15 ? logMed0 + histShift : logMed0;
    const bias = BIAS[h] ?? 0;

    const q: number[] = LEVELS.map((tau) => {
      const f = ((fHour(h, tau) * fSize) / 0.6) * hourMult(h);
      return Math.exp(logMed + (kq[tau] - medA) * f + bias);
    });
    q.sort((a, b) => a - b);

    // Guard for very large p1 (not triggered in practice).
    if (p1 > 875000) {
      let mx = 0;
      for (const cc of kept) {
        const v = cc.raw.get(h);
        if (v !== undefined && v > mx) mx = v;
      }
      const lo = 0.3 * mx;
      const hi = 3 * mx;
      q[2] = Math.min(hi, Math.max(lo, q[2]));
      q.sort((a, b) => a - b);
    }

    hours.push({ hour: h, q });
  }
  return { hours };
}

function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outputDir, { recursive: true });
  const files = fs.readdirSync(inputDir).filter((f) => f.endsWith(".in")).sort();
  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(path.join(inputDir, f), "utf8"));
    const id = String(c.id ?? f.replace(/\.in$/, ""));
    const out = forecastCase(c);
    fs.writeFileSync(path.join(outputDir, `${id}.out`), JSON.stringify(out));
  }
}

main();
