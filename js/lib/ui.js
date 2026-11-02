// Shared UI pieces: state store, URL hash, tooltip, buttons, legend, table, and the chart frame
// every chart uses, so all of them share one size, one margin system and one axis style.
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import { SCENARIOS, LIKELY, BEST, isIncluded, scenLabel, fmtC, fmtTcr } from './core.js';

// ---- State ----------------------------------------------------------------------------------
export function createStore(initial) {
  let state = { ...initial };
  const subscribers = [];
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      for (const fn of subscribers) fn(state, prev);
    },
    subscribe(fn) { subscribers.push(fn); },
  };
}

/** Scenario, selection and comparison mode live in the URL, so a link reopens the same view. */
export function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const out = {};
  if (SCENARIOS.some((s) => s.id === p.get('s'))) out.scenario = p.get('s');
  if (['year', 'gwl'].includes(p.get('x'))) out.xMode = p.get('x');
  const t = p.get('t');
  if (t) {
    const [lo, hi] = t.split('_');
    const a = Number(lo), b = hi === 'max' ? Infinity : Number(hi);
    if (Number.isFinite(a) && b > a) out.screen = [a, b];
  }
  return out;
}

export function writeHash(state) {
  const p = new URLSearchParams();
  p.set('s', state.scenario);
  if (state.screen) p.set('t', `${state.screen[0].toFixed(2)}_${state.screen[1] === Infinity ? 'max' : state.screen[1].toFixed(2)}`);
  p.set('x', state.xMode);
  history.replaceState(null, '', `#${p.toString()}`);
}

// ---- Tooltip ------------------------------------------------------------------------------------
export function createTooltip() {
  const el = d3.select('body').append('div').attr('class', 'tooltip').attr('aria-hidden', 'true');
  let visible = false;
  return {
    show(event, { title, sub, rows = [] }) {
      el.selectAll('*').remove();
      if (title) el.append('div').attr('class', 'tt-title').text(title);
      if (sub) el.append('div').attr('class', 'tt-sub').text(sub);
      for (const r of rows) {
        const row = el.append('div').attr('class', 'tt-row');
        const key = row.append('span').attr('class', `tt-key${r.dot ? ' dot' : ''}`);
        if (r.color) key.style('background', r.color);
        row.append('span').attr('class', 'tt-value').text(r.value);
        row.append('span').attr('class', 'tt-label').text(r.label ?? '');
      }
      visible = true;
      el.style('opacity', 1);
      this.move(event);
    },
    move(event) {
      if (!visible) return;
      const { width, height } = el.node().getBoundingClientRect();
      const cx = event.clientX, cy = event.clientY;
      let left = cx + 14, top = cy + 14;
      if (left + width > innerWidth - 8) left = cx - width - 14;
      if (top + height > innerHeight - 8) top = cy - height - 14;
      el.style('left', `${Math.max(8, left)}px`).style('top', `${Math.max(8, top)}px`);
    },
    hide() { visible = false; el.style('opacity', 0); },
  };
}

// ---- Segmented buttons ------------------------------------------------------------------------
export function buildSegmented(container, options, { isActive, onSelect }) {
  const buttons = d3.select(container).selectAll('button').data(options).join('button')
    .attr('type', 'button')
    .attr('title', (d) => d.note ?? null)
    .text((d) => d.label)
    .on('click', (event, d) => onSelect(d));
  return { update(state) { buttons.attr('aria-pressed', (d) => String(isActive(d, state))); } };
}

// ---- Legend: the sensitivity color scale, with the IPCC likely range marked ----------------------
export function renderLegend(container, color) {
  const root = d3.select(container);
  root.selectAll('*').remove();
  const x = d3.scaleLinear().domain([1.2, 3.0]).range([4, 196]);
  const svg = root.append('svg').attr('viewBox', '0 0 200 34').attr('role', 'img')
    .attr('aria-label', 'Color shows model sensitivity (TCR): blue below the IPCC best estimate of 1.8°C, gray near it, red above. The IPCC likely range is 1.4 to 2.2°C.');
  const id = `tcr-grad-${Math.random().toString(36).slice(2, 8)}`;
  const grad = svg.append('defs').append('linearGradient').attr('id', id);
  d3.range(0, 1.0001, 0.1).forEach((t) => grad.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', color(1.2 + t * 1.8)));
  svg.append('text').attr('class', 'legend-title').attr('x', 4).attr('y', 9).text('Sensitivity (TCR, °C)');
  svg.append('rect').attr('x', 4).attr('y', 14).attr('width', 192).attr('height', 6).attr('rx', 3).attr('fill', `url(#${id})`);
  [1.2, BEST, 3.0].forEach((v, i) => svg.append('text').attr('x', x(v)).attr('y', 32)
    .attr('text-anchor', ['start', 'middle', 'end'][i]).text(v === 3.0 ? '3.0+' : v.toFixed(1)));
}

// ---- Table view: every number reachable without hovering -----------------------------------------
export function createTable(container, data) {
  const table = d3.select(container).append('table');
  const head = table.append('thead').append('tr');
  const body = table.append('tbody');
  return {
    update(state, color) {
      const level = String(state.level);
      const cols = ['Model', 'Institution', 'TCR', ...SCENARIOS.map((s) => `${s.label}, 2081–2100`),
        `Reaches +${level}°C (${scenLabel(state.scenario)})`];
      head.selectAll('th').data(cols).join('th').text((d) => d);
      const rows = body.selectAll('tr').data(data.models, (m) => m.id).join('tr')
        .classed('excluded', (m) => !isIncluded(m, state.screen));
      rows.selectAll('td').data((m) => {
        const cross = m.crossing[state.scenario]?.[level];
        return [
          { model: m, text: m.id },
          { text: m.institution },
          { text: fmtTcr(m.tcr) },
          ...SCENARIOS.map((s) => ({ text: m.warming[s.id] != null ? fmtC(m.warming[s.id]) : 'no run' })),
          { text: m.series[state.scenario] ? String(cross ?? 'after 2100') : 'no run' },
        ];
      }).join('td').each(function (d) {
        const td = d3.select(this);
        td.selectAll('*').remove();
        td.text(null);
        if (d.model) td.append('span').attr('class', 'swatch').style('background', color(d.model.tcr));
        td.append('span').text(d.text);
      });
    },
  };
}

// ---- Chart frame and axes: the same for every chart on both pages ---------------------------------
export const FRAME = { width: 520, height: 330, margin: { top: 22, right: 62, bottom: 42, left: 46 } };

export function makeChart(container, { width = FRAME.width, height = FRAME.height, margin = FRAME.margin, label }) {
  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('role', 'img')
    .attr('aria-label', label);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  return { svg, g, w: width - margin.left - margin.right, h: height - margin.top - margin.bottom, margin };
}

/** y axis = light gridlines + labels, no axis line. Returns an updater for transitions. */
export function yAxis(g, w, { ticks = 5, format = d3.format('.1~f') } = {}) {
  const grid = g.append('g').attr('class', 'grid');
  const axis = g.append('g').attr('class', 'axis y');
  return (y, dur = 0) => {
    grid.transition().duration(dur).call(d3.axisLeft(y).ticks(ticks).tickSize(-w).tickFormat(''));
    axis.transition().duration(dur).call(d3.axisLeft(y).ticks(ticks).tickFormat(format).tickPadding(8));
  };
}

/** x axis = baseline with short ticks. */
export function xAxis(g, h) {
  const axis = g.append('g').attr('class', 'axis x').attr('transform', `translate(0,${h})`);
  return (axisFn, dur = 0) => axis.transition().duration(dur).call(axisFn.tickSizeOuter(0).tickSize(4).tickPadding(6));
}

export function axisTitles(g, { w, h, margin }, xText, yText) {
  const x = g.append('text').attr('class', 'axis-title').attr('text-anchor', 'middle').attr('x', w / 2).attr('y', h + 36);
  const y = g.append('text').attr('class', 'axis-title').attr('text-anchor', 'middle')
    .attr('transform', `translate(${-margin.left + 12},${h / 2}) rotate(-90)`);
  x.text(xText);
  y.text(yText);
  return { x, y };
}

// ---- Label placement: keep short labels off the data dots and off each other ----------------------
/** The box a short label covers at a spot (y is its baseline), including its 2px halo. */
function labelBox({ x, y, anchor }, width) {
  const x0 = (anchor === 'end' ? x - width : x) - 2;
  return [x0, y - 11, x0 + width + 4, y + 3];
}

/** The box an existing text element covers, as [x0, y0, x1, y1]. */
export function textBox(text) {
  const b = text.node().getBBox();
  return [b.x, b.y, b.x + b.width, b.y + b.height];
}

/**
 * Picks a spot for a short label. Tries the spots ({ x, y, anchor }, y = baseline) in order and returns
 * the first that covers no dot and no other label, else the one that covers the fewest dots.
 * dots: [x, y] centres of dots of radius r. boxes: labels already placed; the chosen box is added to it.
 */
export function placeLabel(spots, width, { dots = [], r = 5, boxes = [] } = {}) {
  const clashes = (spot) => {
    const [x0, y0, x1, y1] = labelBox(spot, width);
    const onDots = dots.filter(([cx, cy]) => Math.hypot(Math.max(x0 - cx, 0, cx - x1), Math.max(y0 - cy, 0, cy - y1)) < r);
    const onLabels = boxes.filter(([a0, b0, a1, b1]) => a0 < x1 && x0 < a1 && b0 < y1 && y0 < b1);
    return onDots.length + 100 * onLabels.length;
  };
  let best = spots[0];
  let fewest = Infinity;
  for (const spot of spots) {
    const n = clashes(spot);
    if (n < fewest) [best, fewest] = [spot, n];
    if (n === 0) break;
  }
  boxes.push(labelBox(best, width));
  return best;
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const duration = (ms) => (reducedMotion() ? 0 : ms);
