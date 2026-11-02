// View 3: Arctic warming in each model, against the calendar year or against that model's own global
// warming. Switching animates every line, which separates "when" (timing) from "what" (pattern).
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import { hasRun, isIncluded, timingVsPattern, fmtC, fmtAbsC, fmtLevel, regionLabel } from '../lib/core.js';
import { makeChart, yAxis, xAxis, axisTitles, duration } from '../lib/ui.js';

const FIRST = 1860;   // the 20-year running mean covers 1859 to 2090
const LAST = 2090;

export function createWhenWhatPanel(root, ctx) {
  const { data, store, tooltip } = ctx;
  const caption = root.querySelector('.caption');
  const note = root.querySelector('.note');
  const years = data.years;
  const idx = d3.range(years.indexOf(FIRST), years.indexOf(LAST) + 1);
  const frame = makeChart(root.querySelector('.chart'), {
    label: 'Line chart of Arctic warming in each model, against year or against global warming level.',
  });
  const { svg, g, w, h } = frame;
  const clipId = `clip-${Math.random().toString(36).slice(2, 8)}`;
  svg.append('defs').append('clipPath').attr('id', clipId).append('rect')
    .attr('x', -2).attr('y', -4).attr('width', w + 4).attr('height', h + 6);

  const xYear = d3.scaleLinear().domain([FIRST, LAST]).range([0, w]);
  const xGwl = d3.scaleLinear().range([0, w]);
  const y = d3.scaleLinear().range([h, 0]);

  const updateY = yAxis(g, w);
  const updateX = xAxis(g, h);
  const xAxisNode = g.select('.axis.x');
  const titles = axisTitles(g, frame, 'Year', 'Arctic warming (°C)');
  const refLine = g.append('line').attr('class', 'ref').attr('y1', 0).attr('y2', h).style('pointer-events', 'none');
  const refLabel = g.append('text').attr('class', 'label halo').attr('y', -8).style('pointer-events', 'none');
  const gLines = g.append('g').attr('clip-path', `url(#${clipId})`).attr('fill', 'none').attr('stroke-linejoin', 'round');
  const hoverHalo = g.append('path').attr('clip-path', `url(#${clipId})`).attr('fill', 'none').attr('stroke-width', 5.5)
    .style('pointer-events', 'none');
  const hoverPath = g.append('path').attr('clip-path', `url(#${clipId})`).attr('fill', 'none').attr('stroke-width', 2.25)
    .style('pointer-events', 'none');
  const gDots = g.append('g').style('pointer-events', 'none');
  const bracket = g.append('path').attr('fill', 'none').attr('stroke-width', 1.25).style('pointer-events', 'none');
  const bracketText = g.append('text').attr('class', 'label-strong halo').style('pointer-events', 'none');
  const overlay = g.append('rect').attr('width', w).attr('height', h).attr('fill', 'transparent');

  let current = null;
  let delaunay = null;
  let hits = [];

  const xOf = (state, m, i) => (state.xMode === 'year' ? xYear(years[i]) : xGwl(m.series[state.scenario].global_s[i]));

  function render(state, prev) {
    const scen = state.scenario;
    const key = `${state.region}_s`;
    const models = data.models.filter((m) => hasRun(m, scen) && m.series[scen][key]);
    const ok = (m, i) => m.series[scen][key][i] != null && m.series[scen].global_s[i] != null;
    const modeChanged = prev && prev.xMode !== state.xMode;
    const dur = state.live ? 0 : duration(modeChanged ? 1100 : 500);
    const ease = d3.easeCubicInOut;

    // Scales depend on scenario and region only, never on the selection.
    xGwl.domain([Math.min(-0.3, d3.min(models, (m) => d3.min(idx, (i) => m.series[scen].global_s[i]))),
      d3.max(models, (m) => d3.max(idx, (i) => m.series[scen].global_s[i]))]).nice();
    y.domain([Math.min(-0.5, d3.min(models, (m) => d3.min(idx, (i) => m.series[scen][key][i]))),
      Math.max(1, d3.max(models, (m) => d3.max(idx, (i) => m.series[scen][key][i])))]).nice();
    updateY(y, dur);

    const axis = state.xMode === 'year'
      ? d3.axisBottom(xYear).tickValues([1860, 1900, 1950, 2000, 2050, 2090]).tickFormat(d3.format('d'))
      : d3.axisBottom(xGwl).ticks(7).tickFormat((d) => (d > 0 ? `+${d}` : d3.format('.1~f')(d)));
    if (modeChanged && dur) {
      xAxisNode.transition().duration(dur / 2).style('opacity', 0)
        .on('end', () => { updateX(axis); xAxisNode.transition().duration(dur / 2).style('opacity', 1); });
    } else {
      updateX(axis);
      xAxisNode.style('opacity', 1);
    }
    titles.x.text(state.xMode === 'year' ? 'Year' : 'Global warming of the same model (°C)');
    titles.y.text(`${regionLabel(state.region)} warming (°C)`);
    note.textContent = state.xMode === 'year'
      ? '20-year averages. Compare by warming level to line the models up at equal global warming.'
      : '20-year averages, each line plotted against its own model\'s global warming.';

    // Lines: kept models above faded ones; within kept, the most sensitive on top.
    const items = models.map((m) => ({ m, inc: isIncluded(m, state.screen) }))
      .sort((a, b) => d3.ascending(a.inc, b.inc) || d3.ascending(a.m.tcr, b.m.tcr));
    const pathFor = (d) => d3.line().defined((i) => ok(d.m, i))
      .x((i) => xOf(state, d.m, i)).y((i) => y(d.m.series[scen][key][i]))(idx);
    gLines.selectAll('path').data(items, (d) => d.m.id)
      .join((enter) => enter.append('path').attr('d', pathFor).attr('opacity', 0))
      .order()
      .transition().duration(dur).ease(ease)
      .attr('d', pathFor)
      .attr('stroke', (d) => (d.inc ? ctx.color(d.m.tcr) : ctx.pal.excluded))
      .attr('stroke-width', (d) => (d.inc ? 1.5 : 1))
      .attr('opacity', (d) => (d.inc ? 0.95 : 0.55));

    // Reference: the year the average kept model reaches +2 °C, or +2 °C itself.
    const kept = models.filter((m) => isIncluded(m, state.screen));
    const tvp = timingVsPattern(kept, scen, key, state.level);
    current = { state, key, tvp };
    let dots = [];
    if (tvp.yearIndex >= 0 && tvp.enough) {
      const yr = years[tvp.yearIndex];
      const rx = state.xMode === 'year' ? xYear(yr) : xGwl(state.level);
      refLine.transition().duration(dur).ease(ease).attr('x1', rx).attr('x2', rx).attr('opacity', 1);
      refLabel.transition().duration(dur).ease(ease).attr('x', rx).attr('opacity', 1)
        .attr('text-anchor', rx > w * 0.75 ? 'end' : 'middle')
        .text(state.xMode === 'year' ? `${yr}: average model at ${fmtLevel(state.level)}` : `${fmtLevel(state.level)} in every model`);
      dots = tvp.reach.map((r, j) => {
        const i = state.xMode === 'year' ? tvp.yearIndex : r.i;
        return { m: r.m, cx: xOf(state, r.m, i), cy: y(r.m.series[scen][key][i]), v: (state.xMode === 'year' ? tvp.atYear : tvp.atLevel)[j] };
      });
    } else {
      refLine.transition().duration(dur).attr('opacity', 0);
      refLabel.transition().duration(dur).attr('opacity', 0);
    }
    gDots.selectAll('circle').data(dots, (d) => d.m.id)
      .join((enter) => enter.append('circle').attr('r', 3.5).attr('cx', (d) => d.cx).attr('cy', (d) => d.cy))
      .transition().duration(dur).ease(ease)
      .attr('cx', (d) => d.cx).attr('cy', (d) => d.cy)
      .attr('fill', (d) => ctx.color(d.m.tcr)).attr('stroke', ctx.pal.bg).attr('stroke-width', 1.25);

    const vals = dots.map((d) => d.v).filter(Number.isFinite).sort(d3.ascending);
    if (vals.length >= 3) {
      const lo = d3.quantileSorted(vals, 0.05), hi = d3.quantileSorted(vals, 0.95);
      const bx = Math.min(d3.max(dots, (d) => d.cx) + 10, w + 4);
      bracket.attr('stroke', ctx.pal.ink).transition().duration(dur).ease(ease).attr('opacity', 1)
        .attr('d', `M${bx - 4},${y(hi)}H${bx}V${y(lo)}H${bx - 4}`);
      bracketText.transition().duration(dur).ease(ease).attr('opacity', 1)
        .attr('x', bx + 6).attr('y', (y(hi) + y(lo)) / 2 + 4).text(fmtAbsC(hi - lo));
    } else {
      bracket.transition().duration(dur).attr('opacity', 0);
      bracketText.transition().duration(dur).attr('opacity', 0);
    }

    // Nearest-point lookup for hover, in this mode's final positions.
    hits = [];
    for (const d of items) {
      if (!d.inc) continue;
      for (const i of idx) if (ok(d.m, i)) hits.push({ m: d.m, i, px: xOf(state, d.m, i), py: y(d.m.series[scen][key][i]) });
    }
    delaunay = d3.Delaunay.from(hits, (p) => p.px, (p) => p.py);

    const level = fmtLevel(state.level);
    const region = regionLabel(state.region);
    const missing = tvp.nAll - tvp.reach.length;
    if (!kept.length) caption.textContent = 'No models kept.';
    else if (tvp.yearIndex < 0 || !tvp.enough) {
      caption.textContent = (tvp.reach.length
        ? `Only ${tvp.reach.length} of the ${tvp.nAll} kept models reach ${level} by 2100 under this scenario, `
        : `None of the ${tvp.nAll} kept models reach ${level} by 2100 under this scenario, `)
        + 'too few to compare. Try a higher-emissions scenario.';
    } else if (state.xMode === 'year') {
      caption.textContent = `In ${years[tvp.yearIndex]}, when the average model reaches ${level}, ${region} warming `
        + `differs by ${fmtAbsC(tvp.spreadYear)} across models (middle 90%).`;
    } else {
      caption.textContent = `Lined up at ${level} of global warming, ${region} warming differs by `
        + `${fmtAbsC(tvp.spreadLevel)}, down from ${fmtAbsC(tvp.spreadYear)} when compared by year.`;
    }
    if (missing > 0 && tvp.enough && tvp.yearIndex >= 0) {
      caption.textContent += missing === 1 ? ` (1 kept model never reaches ${level}.)` : ` (${missing} kept models never reach ${level}.)`;
    }
    renderHover(state.hover);
  }

  function renderHover(id) {
    const m = id && data.byId.get(id);
    const state = current?.state;
    const s = m && state && m.series[state.scenario];
    if (!s || !s[current.key]) { hoverPath.attr('d', null); hoverHalo.attr('d', null); return; }
    const d = d3.line().defined((i) => s[current.key][i] != null && s.global_s[i] != null)
      .x((i) => xOf(state, m, i)).y((i) => y(s[current.key][i]))(idx);
    hoverHalo.attr('stroke', ctx.pal.bg).attr('d', d);
    hoverPath.attr('stroke', ctx.pal.ink).attr('d', d);
  }

  overlay.on('pointermove', (event) => {
    if (!delaunay || !hits.length) return;
    const [px, py] = d3.pointer(event, g.node());
    const p = hits[delaunay.find(px, py)];
    if (!p || Math.hypot(p.px - px, p.py - py) > 24) {
      tooltip.hide();
      if (store.get().hover) store.set({ hover: null });
      return;
    }
    if (store.get().hover !== p.m.id) store.set({ hover: p.m.id });
    const s = p.m.series[current.state.scenario];
    tooltip.show(event, {
      title: p.m.id,
      sub: `${years[p.i]}, 20-year average`,
      rows: [
        { value: fmtC(s[current.key][p.i]), label: regionLabel(current.state.region), color: ctx.color(p.m.tcr) },
        { value: fmtC(s.global_s[p.i]), label: 'global' },
      ],
    });
  }).on('pointerleave', () => {
    tooltip.hide();
    if (store.get().hover) store.set({ hover: null });
  });

  return {
    update(state, prev) {
      const changed = (k) => !prev || state[k] !== prev[k];
      if (['scenario', 'screen', 'theme', 'region', 'xMode', 'level'].some(changed)) render(state, prev);
      else if (changed('hover')) renderHover(state.hover);
    },
  };
}
