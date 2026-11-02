// View 2: global warming 1850-2100. The kept models' average and middle 90%, against all models,
// so the effect of the selection shows as a gap between two lines.
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import { hasRun, isIncluded, ensembleByYear, fmtC, fmt1, fmtAbsC, scenLabel } from '../lib/core.js';
import { makeChart, yAxis, xAxis, axisTitles, duration } from '../lib/ui.js';

export function createEnsemblePanel(root, ctx) {
  const { data, store, tooltip } = ctx;
  const caption = root.querySelector('.caption');
  const years = data.years;
  const frame = makeChart(root.querySelector('.chart'), {
    label: 'Line chart of global warming from 1850 to 2100 for the kept models compared with all models.',
  });
  const { g, w, h } = frame;
  const x = d3.scaleLinear().domain([1850, 2100]).range([0, w]);
  const y = d3.scaleLinear().range([h, 0]);

  g.append('rect').attr('class', 'wash').attr('x', x(2081)).attr('width', x(2100) - x(2081)).attr('y', 0).attr('height', h);
  g.append('text').attr('class', 'label-muted').attr('x', (x(2081) + x(2100)) / 2).attr('y', -8)
    .attr('text-anchor', 'middle').text('2081–2100');
  const updateY = yAxis(g, w);
  xAxis(g, h)(d3.axisBottom(x).tickValues([1850, 1900, 1950, 2000, 2050, 2100]).tickFormat(d3.format('d')));
  axisTitles(g, frame, 'Year', 'Global warming (°C)');
  g.append('line').attr('class', 'ref-soft').attr('x1', x(2014.5)).attr('x2', x(2014.5)).attr('y1', 0).attr('y2', h);
  g.append('text').attr('class', 'label-muted').attr('x', x(2014.5) - 6).attr('y', 11).attr('text-anchor', 'end').text('Historical');
  const scenText = g.append('text').attr('class', 'label-muted').attr('x', x(2014.5) + 6).attr('y', 11);

  const bandPath = g.append('path').attr('class', 'band');
  const allPath = g.append('path').attr('fill', 'none').attr('stroke-width', 1.5);
  const keptPath = g.append('path').attr('fill', 'none').attr('stroke-width', 2.25);
  const gEnd = g.append('g');
  const gCross = g.append('g').style('pointer-events', 'none');
  const overlay = g.append('rect').attr('width', w).attr('height', h).attr('fill', 'transparent');

  const line = d3.line().defined((d) => d != null).x((d, i) => x(years[i])).curve(d3.curveMonotoneX);
  const area = d3.area().defined((d) => d != null).x((d, i) => x(years[i])).y0((d) => y(d.lo)).y1((d) => y(d.hi))
    .curve(d3.curveMonotoneX);
  let current = null;

  function render(state) {
    const scen = state.scenario;
    const all = data.models.filter((m) => hasRun(m, scen));
    const kept = all.filter((m) => isIncluded(m, state.screen));
    const screened = Boolean(state.screen);
    const allStats = ensembleByYear(all, scen, 'global', years.length);
    const keptStats = kept.length ? ensembleByYear(kept, scen, 'global', years.length) : allStats.map(() => null);
    current = { scen, all, kept, allStats, keptStats, screened };

    const dur = state.live ? 0 : duration(500);
    // The scale depends only on the scenario, never on the selection, so the change stays visible.
    const maxAll = d3.max(all, (m) => d3.max(m.series[scen].global));
    const minAll = d3.min(all, (m) => d3.min(m.series[scen].global));
    y.domain([Math.min(-0.5, minAll), Math.max(1.5, maxAll)]).nice();
    updateY(y, dur);
    scenText.text(scenLabel(scen));

    const mean = line.y((d) => y(d.mean));
    bandPath.datum(keptStats).transition().duration(dur).attr('d', area);
    allPath.datum(allStats).attr('stroke', ctx.pal.muted).transition().duration(dur)
      .attr('d', mean).attr('opacity', screened ? 1 : 0);
    keptPath.datum(keptStats).attr('stroke', ctx.pal.ink).transition().duration(dur).attr('d', mean);

    // End labels: the 2081-2100 average of each line, in the right margin.
    const avg = (models) => d3.mean(models, (m) => m.warming[scen]);
    const items = [];
    if (kept.length) items.push({ key: 'kept', value: avg(kept), label: screened ? 'kept' : 'all models', strong: true });
    if (screened) items.push({ key: 'all', value: avg(all), label: 'all models', strong: false });
    items.forEach((d) => { d.y = y(d.value); d.ly = d.y; });
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (items[i].ly - items[i - 1].ly < 32) items[i].ly = items[i - 1].ly + 32;
    const end = gEnd.selectAll('g').data(items, (d) => d.key).join((enter) => {
      const e = enter.append('g');
      e.append('text').attr('class', 'value');
      e.append('text').attr('class', 'label-muted name');
      return e;
    });
    end.select('text.value').attr('class', (d) => `value ${d.strong ? 'label-strong' : 'label'}`)
      .transition().duration(dur).attr('x', w + 8).attr('y', (d) => d.ly + 4).text((d) => fmtC(d.value));
    end.select('text.name').transition().duration(dur).attr('x', w + 8).attr('y', (d) => d.ly + 17).text((d) => d.label);

    if (!kept.length) {
      caption.textContent = 'No models kept.';
    } else if (!screened) {
      const [lo, hi] = d3.extent(all, (m) => m.warming[scen]);
      caption.textContent = `All ${all.length} models average ${fmtC(avg(all))} by 2081–⁠2100, `
        + `but individual models range from ${fmtC(lo)} to ${fmtC(hi)}.`;
    } else {
      const diff = avg(kept) - avg(all);
      caption.textContent = `The ${kept.length} kept models average ${fmtC(avg(kept))} by 2081–⁠2100, `
        + `${fmtAbsC(diff)} ${diff < 0 ? 'below' : 'above'} all models (${fmtC(avg(all))}).`;
    }
    renderHover(state.hover);
  }

  function renderHover() {}

  // Crosshair: snaps to the nearest year and reads out each line there.
  overlay.on('pointermove', (event) => {
    if (!current) return;
    const [px] = d3.pointer(event, g.node());
    const year = Math.max(1850, Math.min(2100, Math.round(x.invert(px))));
    const i = year - years[0];
    const k = current.keptStats[i], a = current.allStats[i];
    gCross.selectAll('*').remove();
    gCross.append('line').attr('class', 'crosshair').attr('x1', x(year)).attr('x2', x(year)).attr('y1', 0).attr('y2', h);
    const rows = [];
    if (k) {
      gCross.append('circle').attr('cx', x(year)).attr('cy', y(k.mean)).attr('r', 3.5).attr('fill', ctx.pal.ink)
        .attr('stroke', ctx.pal.bg).attr('stroke-width', 1.5);
      rows.push({ value: fmtC(k.mean), label: current.screened ? `kept (${k.n})` : `all models (${k.n})`, color: ctx.pal.ink });
      rows.push({ value: `${fmt1(k.lo)} to ${fmt1(k.hi)}`, label: 'middle 90%' });
    }
    if (current.screened && a) rows.push({ value: fmtC(a.mean), label: `all models (${a.n})`, color: ctx.pal.muted });
    const hov = store.get().hover && data.byId.get(store.get().hover);
    const hv = hov?.series[current.scen]?.global[i];
    if (hv != null) rows.push({ value: fmtC(hv), label: hov.id, color: ctx.color(hov.tcr) });
    tooltip.show(event, { title: String(year), sub: year <= 2014 ? 'Historical' : scenLabel(current.scen), rows });
  }).on('pointerleave', () => {
    gCross.selectAll('*').remove();
    tooltip.hide();
  });

  return {
    update(state, prev) {
      const changed = (k) => !prev || state[k] !== prev[k];
      if (changed('scenario') || changed('screen') || changed('theme')) render(state);
      else if (changed('hover')) renderHover(state.hover);
    },
  };
}
