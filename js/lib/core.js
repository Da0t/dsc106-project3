// Data loading, constants, statistics and formatting shared by every chart.
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

export const SCENARIOS = [
  { id: 'ssp126', label: 'SSP1-2.6', note: 'Low emissions' },
  { id: 'ssp245', label: 'SSP2-4.5', note: 'Middle-of-the-road emissions' },
  { id: 'ssp585', label: 'SSP5-8.5', note: 'Very high emissions' },
];
export const LEVELS = [1.5, 2, 3, 4];
export const REGIONS = [
  { id: 'arctic', label: 'Arctic' },
  { id: 'tropics', label: 'Tropics' },
  { id: 'socal', label: 'Southern California' },
];
// IPCC AR6 (2021) assessed transient climate response: likely range and best estimate, °C.
export const LIKELY = [1.4, 2.2];
export const BEST = 1.8;
export const PRESETS = [
  { id: 'all', label: 'All', range: null },
  { id: 'likely', label: 'IPCC likely range', range: [LIKELY[0], LIKELY[1]] },
  { id: 'hot', label: 'Hot only', range: [LIKELY[1] + 0.001, Infinity] },
];

// ---- Data -------------------------------------------------------------------------
export async function loadData(base = 'data/') {
  const [m, s] = await Promise.all([d3.json(`${base}models.json`), d3.json(`${base}series.json`)]);
  const years = s.years;
  const models = m.models
    .map((d) => ({
      id: d.id,
      institution: d.institution,
      tcr: d.tcr,
      warming: d.warming_2081_2100 ?? {},
      crossing: d.crossing ?? {},
      series: s.series[d.id] ?? {},
    }))
    .filter((d) => Number.isFinite(d.tcr))
    .sort((a, b) => d3.descending(a.tcr, b.tcr));
  return { meta: m.meta ?? {}, models, byId: new Map(models.map((d) => [d.id, d])), years };
}

export const hasRun = (model, scen) => Boolean(model.series[scen]);
export const groupOf = (model) => (model.tcr > LIKELY[1] ? 'hot' : model.tcr < LIKELY[0] ? 'low' : 'likely');
export const isIncluded = (model, screen) => !screen || (model.tcr >= screen[0] && model.tcr <= screen[1]);

export function presetFor(screen) {
  if (!screen) return 'all';
  const close = (a, b) => Math.abs(a - b) < 0.006;
  if (close(screen[0], LIKELY[0]) && close(screen[1], LIKELY[1])) return 'likely';
  if (close(screen[0], LIKELY[1]) && screen[1] === Infinity) return 'hot';
  return null;
}

// ---- Statistics ---------------------------------------------------------------------
export function ols(points) {
  if (points.length < 3) return null;
  const mx = d3.mean(points, (p) => p.x);
  const my = d3.mean(points, (p) => p.y);
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: sxy / Math.sqrt(sxx * syy) };
}

/** Width of the middle 90% of values (5th to 95th percentile). */
export function spread(values) {
  const v = values.filter(Number.isFinite).sort(d3.ascending);
  return v.length < 2 ? NaN : d3.quantileSorted(v, 0.95) - d3.quantileSorted(v, 0.05);
}

export function middle90(values) {
  const v = values.filter(Number.isFinite).sort(d3.ascending);
  return v.length ? [d3.quantileSorted(v, 0.05), d3.quantileSorted(v, 0.95)] : [NaN, NaN];
}

export function firstAtLeast(arr, level) {
  for (let i = 0; i < arr.length; i++) if (arr[i] != null && arr[i] >= level) return i;
  return -1;
}

/** Per-year mean and middle-90% band across models for one series key. */
export function ensembleByYear(models, scen, key, nYears) {
  const out = new Array(nYears);
  for (let i = 0; i < nYears; i++) {
    const vals = [];
    for (const m of models) {
      const v = m.series[scen]?.[key]?.[i];
      if (v != null) vals.push(v);
    }
    vals.sort(d3.ascending);
    out[i] = vals.length
      ? { mean: d3.mean(vals), lo: d3.quantileSorted(vals, 0.05), hi: d3.quantileSorted(vals, 0.95), n: vals.length }
      : null;
  }
  return out;
}

/**
 * Timing versus pattern at a global warming level (mirrors story_check in the pipeline).
 * The reference year is when the average of ALL given models reaches the level. The two spreads compare
 * the same set of models: those that reach the level, once in that reference year and once each at the
 * moment it reaches the level itself. `enough` is false when fewer than two-thirds of the models get there.
 */
export function timingVsPattern(models, scen, key, level) {
  const withRun = models.filter((m) => m.series[scen]?.global_s && m.series[scen][key]);
  const reach = [];
  for (const m of withRun) {
    const i = firstAtLeast(m.series[scen].global_s, level);
    if (i >= 0) reach.push({ m, i });
  }
  const result = { reach, nAll: withRun.length, yearIndex: -1, spreadYear: NaN, spreadLevel: NaN, enough: false };
  if (!withRun.length) return result;
  const n = withRun[0].series[scen].global_s.length;
  const meanCurve = d3.range(n).map((i) => d3.mean(withRun, (m) => m.series[scen].global_s[i]));
  result.yearIndex = firstAtLeast(meanCurve, level);
  result.enough = reach.length >= 3 && reach.length >= (2 / 3) * withRun.length;
  if (result.yearIndex < 0 || !result.enough) return result;
  result.atYear = reach.map((r) => r.m.series[scen][key][result.yearIndex]);
  result.atLevel = reach.map((r) => r.m.series[scen][key][r.i]);
  result.spreadYear = spread(result.atYear);
  result.spreadLevel = spread(result.atLevel);
  return result;
}

/** Median of crossing years where "never" counts as later than any year (Infinity). */
export function medianYear(values) {
  const v = values.slice().sort((a, b) => a - b);
  const n = v.length;
  if (!n) return null;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

// ---- Formatting ---------------------------------------------------------------------
const MINUS = '−';
export const fmt1 = (v) => `${v < 0 ? MINUS : ''}${Math.abs(v).toFixed(1)}`;
export const fmtSigned = (v) => `${v < 0 ? MINUS : '+'}${Math.abs(v).toFixed(1)}`;
export const fmtC = (v) => `${fmtSigned(v)}°C`;
export const fmtAbsC = (v) => `${Math.abs(v).toFixed(1)}°C`;
export const fmtTcr = (v) => `${v.toFixed(2)}°C`;
export const fmtLevel = (l) => `+${l}°C`;
export const scenLabel = (id) => SCENARIOS.find((s) => s.id === id)?.label ?? id;
export const regionLabel = (id) => REGIONS.find((r) => r.id === id)?.label ?? id;

// ---- Theme ---------------------------------------------------------------------------
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Sensitivity colors: blue below the IPCC best estimate, gray at it, red above (clamped 1.2-3.0 °C). */
export function makeTcrColor() {
  const interp = d3.piecewise(d3.interpolateLab, [cssVar('--tcr-low'), cssVar('--tcr-mid'), cssVar('--tcr-high')]);
  return d3.scaleDiverging(interp).domain([1.2, BEST, 3.0]).clamp(true);
}

export function readPalette() {
  const names = ['bg', 'ink', 'ink-2', 'muted', 'excluded', 'grid', 'axis', 'cat-a', 'cat-b'];
  return Object.fromEntries(names.map((n) => [n, cssVar(`--${n}`)]));
}
