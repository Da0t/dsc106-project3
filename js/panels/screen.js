// View 1: sensitivity (TCR) against end-of-century warming. Brushing along the x axis chooses which
// models every other view keeps.
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import { LIKELY, isIncluded, ols, fmtC, fmtTcr, scenLabel } from '../lib/core.js';
import { makeChart, yAxis, xAxis, axisTitles, duration } from '../lib/ui.js';

export function createScreenPanel(root, ctx) {
  const { data, store, tooltip } = ctx;
  const caption = root.querySelector('.caption');
  const frame = makeChart(root.querySelector('.chart'), {
    label: 'Scatter plot of each model\'s sensitivity against its warming by 2081 to 2100.',
  });
  const { g, w, h } = frame;

  const tcrs = data.models.map((m) => m.tcr);
  const x = d3.scaleLinear()
    .domain([Math.min(1.1, d3.min(tcrs) - 0.08), Math.max(3.1, d3.max(tcrs) + 0.08)])
    .range([0, w]);
  const y = d3.scaleLinear().range([h, 0]);

  g.append('rect').attr('class', 'wash')
    .attr('x', x(LIKELY[0])).attr('width', x(LIKELY[1]) - x(LIKELY[0])).attr('y', 0).attr('height', h);
  g.append('text').attr('class', 'label-muted').attr('text-anchor', 'middle')
    .attr('x', (x(LIKELY[0]) + x(LIKELY[1])) / 2).attr('y', -8).text('IPCC likely range');
  const updateY = yAxis(g, w);
  xAxis(g, h)(d3.axisBottom(x).ticks(8).tickFormat(d3.format('.1f')));
  axisTitles(g, frame, 'Sensitivity, TCR (°C)', 'Warming by 2081–2100 (°C)');

  const fitLine = g.append('line').attr('stroke-width', 1).style('pointer-events', 'none');
  const gBrush = g.append('g').attr('class', 'brush');
  const gDots = g.append('g').style('pointer-events', 'none');
  const gFocus = g.append('g').style('pointer-events', 'none');

  // Brush: drag along the x axis to keep the models in that sensitivity range.
  const brush = d3.brushX().extent([[0, 0], [w, h]]).on('start brush end', onBrush);
  gBrush.call(brush);
  let syncing = false;
  let moved = false;
  function onBrush(event) {
    if (syncing || !event.sourceEvent) return;
    if (event.type === 'start') { moved = false; return; }
    if (event.type === 'brush') moved = true;
    const s = event.selection;
    if (!s && !moved) {               // a plain click: keep the current selection
      syncBrush(store.get().screen, true);
      return;
    }
    const screen = s ? [x.invert(s[0]), x.invert(s[1])].map((v) => Math.round(v * 100) / 100) : null;
    store.set({ screen, live: event.type === 'brush' });
  }

  // Hover: the nearest dot within reach, so nobody has to aim at an 11-pixel target.
  let points = [];
  gBrush.on('pointermove.hover', (event) => {
    const [px, py] = d3.pointer(event, g.node());
    let best = null, bestD = 20 * 20;
    for (const p of points) {
      const d2 = (p.px - px) ** 2 + (p.py - py) ** 2;
      if (d2 < bestD) { bestD = d2; best = p; }
    }
    if (best) {
      if (store.get().hover !== best.m.id) store.set({ hover: best.m.id });
      const scen = store.get().scenario;
      tooltip.show(event, {
        title: best.m.id,
        sub: best.m.institution,
        rows: [
          { value: fmtTcr(best.m.tcr), label: 'sensitivity (TCR)', color: ctx.color(best.m.tcr), dot: true },
          { value: fmtC(best.m.warming[scen]), label: `by 2081–2100, ${scenLabel(scen)}` },
        ],
      });
    } else {
      tooltip.hide();
      if (store.get().hover) store.set({ hover: null });
    }
  }).on('pointerleave.hover', () => {
    tooltip.hide();
    if (store.get().hover) store.set({ hover: null });
  });

  function render(state) {
    const scen = state.scenario;
    const pts = data.models.filter((m) => m.warming[scen] != null).map((m) => ({ m, inc: isIncluded(m, state.screen) }));
    const dur = state.live ? 0 : duration(500);
    y.domain([0, Math.max(1, d3.max(pts, (p) => p.m.warming[scen]) * 1.08)]).nice();
    updateY(y, dur);

    const fit = ols(pts.map((p) => ({ x: p.m.tcr, y: p.m.warming[scen] })));
    if (fit) {
      const [x0, x1] = d3.extent(pts, (p) => p.m.tcr);
      fitLine.attr('stroke', ctx.pal.muted).transition().duration(dur)
        .attr('x1', x(x0)).attr('y1', y(fit.intercept + fit.slope * x0))
        .attr('x2', x(x1)).attr('y2', y(fit.intercept + fit.slope * x1));
    }

    points = pts.map((p) => ({ ...p, px: x(p.m.tcr), py: y(p.m.warming[scen]) }));
    gDots.selectAll('circle').data(points, (p) => p.m.id)
      .join((enter) => enter.append('circle').attr('r', 5).attr('cx', (p) => p.px).attr('cy', (p) => p.py))
      .sort((a, b) => d3.ascending(a.inc, b.inc))
      .transition().duration(dur)
      .attr('cx', (p) => p.px)
      .attr('cy', (p) => p.py)
      .attr('fill', (p) => (p.inc ? ctx.color(p.m.tcr) : ctx.pal.bg))
      .attr('stroke', (p) => (p.inc ? ctx.pal.bg : ctx.pal.excluded))
      .attr('stroke-width', 1.5);

    syncBrush(state.screen);

    const kept = pts.filter((p) => p.inc).length;
    if (!state.screen) {
      const link = !fit ? '' : fit.r >= 0.7 ? ' More sensitive models warm more' : fit.r >= 0.4
        ? ' More sensitive models tend to warm more' : ' Sensitivity says little about how much a model warms';
      caption.textContent = `All ${pts.length} models kept.${link}${fit ? ` (r = ${fit.r.toFixed(2)}).` : ''}`;
    } else if (!kept) {
      caption.textContent = 'No models in that range. Drag a wider range or pick a preset.';
    } else {
      const lo = state.screen[0].toFixed(2);
      const range = state.screen[1] === Infinity ? `over ${lo}°C` : `${lo} to ${state.screen[1].toFixed(2)}°C`;
      caption.textContent = `${kept} of ${pts.length} models kept (TCR ${range}). The rest are shown in gray.`;
    }
  }

  function syncBrush(screen, force = false) {
    const [d0, d1] = x.domain();
    const target = screen ? [x(Math.max(screen[0], d0)), x(Math.min(screen[1], d1))] : null;
    const current = d3.brushSelection(gBrush.node());
    const same = (!target && !current)
      || (target && current && Math.abs(target[0] - current[0]) < 1.5 && Math.abs(target[1] - current[1]) < 1.5);
    if (same && !force) return;
    syncing = true;
    gBrush.call(brush.move, target);
    syncing = false;
  }

  function highlight(id) {
    gFocus.selectAll('*').remove();
    const p = points.find((q) => q.m.id === id);
    if (!p) return;
    gFocus.append('circle').attr('cx', p.px).attr('cy', p.py).attr('r', 8.5)
      .attr('fill', 'none').attr('stroke', ctx.pal.ink).attr('stroke-width', 1.25);
    gFocus.append('text').attr('class', 'label-strong halo').attr('text-anchor', 'middle')
      .attr('x', p.px).attr('y', p.py - 13).text(p.m.id);
  }

  return {
    update(state, prev) {
      const changed = (k) => !prev || state[k] !== prev[k];
      if (changed('scenario') || changed('screen') || changed('theme')) render(state);
      if (changed('hover') || changed('scenario') || changed('theme')) highlight(state.hover);
    },
  };
}
