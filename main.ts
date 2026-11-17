// GTA6 Twitch CCU forecast — V19: aligned-jump kernel + local-linear blend,
// with the local-linear weight chosen by the size of the hour-1 print.
// Reads one case file per run from MAKEFUN_INPUT_DIR (else /input) and writes
// one <id>.out per case to MAKEFUN_OUTPUT_DIR (else /output).
// Only the case file's own data is used; standard library only; deterministic.
import * as fs from "node:fs";
import * as path from "node:path";

const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const BANDWIDTH = 0.5;
const SPREAD_SHRINK = 0.75;
const CLAMP_LOG = 2.0;
const SMALL_P1 = 50000;
const LARGE_P1 = 200000;
const MAX_Q = 1e9;

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Weighted empirical quantile: smallest value whose cumulative weight
// reaches tau of the total weight. Inputs must be sorted by value.
function weightedQuantile(pairs: Array<[number, number]>, tau: number): number {
  let total = 0;
  for (const [, w] of pairs) total += w;
  if (total <= 0 || pairs.length === 0) return pairs.length ? pairs[0][0] : 0;
  const target = tau * total;
  let acc = 0;
  for (const [v, w] of pairs) {
    acc += w;
    if (acc >= target) return v;
  }
  return pairs[pairs.length - 1][0];
}

interface Curve {
  // log viewers for release-day hours 1..24, original (unaligned) timeline.
  logV: number[];
  // log viewers on the aligned timeline (jump moved to hour 5); null where
  // the shift pushes the hour outside 1..24.
  alignedLogV: Array<number | null>;
  logV1: number;
}

function extractCurve(comp: any): Curve | null {
  const dayStart = Date.parse(comp.day_start);
  if (!Number.isFinite(dayStart)) return null;
  const logV: Array<number | null> = new Array(24).fill(null);
  for (const row of comp.hourly ?? []) {
    const t = Date.parse(row.from);
    if (!Number.isFinite(t)) continue;
    const h = Math.floor((t - dayStart) / 3600000) + 1;
    if (h < 1 || h > 24) continue;
    const v = Math.max(1, Number(row.viewers) || 1);
    logV[h - 1] = Math.log(v);
  }
  if (logV.some((x) => x === null)) return null;
  const vals = logV as number[];
  // Morning jump: hour h in 4..10 with the largest log hour-to-hour rise.
  let jumpHour = 5;
  let bestRise = -Infinity;
  for (let h = 4; h <= 10; h++) {
    const rise = vals[h - 1] - vals[h - 2];
    if (rise > bestRise) {
      bestRise = rise;
      jumpHour = h;
    }
  }
  const shift = 5 - jumpHour;
  const alignedLogV: Array<number | null> = new Array(24).fill(null);
  for (let h = 1; h <= 24; h++) {
    const src = h - shift;
    if (src >= 1 && src <= 24) alignedLogV[h - 1] = vals[src - 1];
  }
  return { logV: vals, alignedLogV, logV1: vals[0] };
}

function localLinearMedian(
  curves: Curve[],
  hour: number,
  logP1: number,
): number {
  // OLS of ln(v_h) on ln(v1) across all comparables (unaligned timeline).
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of curves) {
    xs.push(c.logV1);
    ys.push(c.logV[hour - 1]);
  }
  const n = xs.length;
  if (n === 0) return logP1;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    sxx += dx * dx;
    sxy += dx * (ys[i] - my);
  }
  const slope = sxx > 1e-12 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  return intercept + slope * logP1;
}

function forecastCase(caseData: any): { hours: Array<{ hour: number; q: number[] }> } {
  const p1 = Math.max(1, Number(caseData.known?.[0]?.viewers) || 1);
  const logP1 = Math.log(p1);
  const curves: Curve[] = [];
  for (const comp of caseData.comparables ?? []) {
    const c = extractCurve(comp);
    if (c) curves.push(c);
  }

  // Size-adaptive local-linear weight.
  const wL = p1 < SMALL_P1 ? 0.75 : p1 < LARGE_P1 ? 0.5 : 0.35;

  const hours: Array<{ hour: number; q: number[] }> = [];
  for (let h = 2; h <= 24; h++) {
    // (a) Aligned-jump kernel: Gaussian weights on ln p1 vs ln v1_c
    // (original hour-1), empirical quantiles of the log-ratios taken
    // INSIDE the aligned curve, r = ln(aligned v_h / aligned v1).
    // A comparable whose aligned hour-1 falls outside 1..24 has no
    // aligned anchor and is left out of the kernel for every hour.
    const pairs: Array<[number, number]> = [];
    for (const c of curves) {
      const av = c.alignedLogV[h - 1];
      const a1 = c.alignedLogV[0];
      if (av === null || a1 === null) continue;
      const d = logP1 - c.logV1;
      const w = Math.exp(-(d * d) / (2 * BANDWIDTH * BANDWIDTH));
      pairs.push([av - a1, w]);
    }
    pairs.sort((a, b) => a[0] - b[0]);

    let logQuantiles: number[];
    let kernelLogMedian: number;
    if (pairs.length === 0) {
      // No comparable covers this hour: fall back to persistence.
      kernelLogMedian = logP1;
      logQuantiles = LEVELS.map(() => logP1);
    } else {
      const ratioQs = LEVELS.map((tau) => weightedQuantile(pairs, tau));
      // Convert the kernel median from log-ratio to log-level BEFORE
      // clamping / blending: log-level median = ln p1 + log-ratio median.
      kernelLogMedian = logP1 + ratioQs[2];
      // Kernel quantiles in log-level, spread shrunk x0.75 toward median.
      logQuantiles = ratioQs.map(
        (rq) => kernelLogMedian + SPREAD_SHRINK * (logP1 + rq - kernelLogMedian),
      );
    }

    // (b) Local-linear median, clamped within exp(+-2) of the kernel median.
    let llLogMedian = localLinearMedian(curves, h, logP1);
    llLogMedian = Math.max(
      kernelLogMedian - CLAMP_LOG,
      Math.min(kernelLogMedian + CLAMP_LOG, llLogMedian),
    );

    // Geometric blend in log space.
    const finalLogMedian = (1 - wL) * kernelLogMedian + wL * llLogMedian;

    // Spread from the kernel (shrunk), re-centred on the blended median.
    const q = logQuantiles.map((lq) => {
      const v = Math.exp(finalLogMedian + (lq - kernelLogMedian));
      return Math.min(MAX_Q, Math.max(1, v));
    });
    // Enforce non-decreasing quantiles.
    for (let i = 1; i < q.length; i++) {
      if (q[i] < q[i - 1]) q[i] = q[i - 1];
    }
    hours.push({ hour: h, q });
  }
  return { hours };
}

function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outputDir, { recursive: true });
  const files = fs
    .readdirSync(inputDir)
    .filter((f) => f.endsWith(".in"))
    .sort();
  for (const file of files) {
    const caseData = JSON.parse(
      fs.readFileSync(path.join(inputDir, file), "utf8"),
    );
    const out = forecastCase(caseData);
    const id = String(caseData.id ?? file.replace(/\.in$/, ""));
    fs.writeFileSync(
      path.join(outputDir, `${id}.out`),
      JSON.stringify(out),
    );
  }
}

main();
