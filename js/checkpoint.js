// Checkpoint page: six exploratory graphs that led to our question. Same frame, fonts and colors as the
// interactive graphic. Every title is computed from the data, so it stays true for the real CMIP6 numbers.
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import {
  loadData, LIKELY, hasRun, ols, ensembleByYear, timingVsPattern, medianYear, fmtC, fmtAbsC, fmtTcr, makeTcrColor,
  readPalette,
} from './lib/core.js';
import { makeChart, yAxis, xAxis, axisTitles, createTooltip, renderLegend, placeLabel, textBox } from './lib/ui.js';
import { TEAM } from './team.js';

const data = await loadData();
const color = makeTcrColor();
const pal = readPalette();
const tooltip = createTooltip();
const years = data.years;
const idx = (year) => year - years[0];
const SCEN = 'ssp245';

document.getElementById('demo-banner').hidden = !data.meta.demo;
{
  const teamName = TEAM.name.trim();
  const strong = Object.assign(document.createElement('strong'), { textContent: teamName });
  document.getElementById('team').replaceChildren(...(teamName ? [strong, ' · '] : []), TEAM.members.join(', '));
}
document.getElementById('generated').textContent = data.meta.generated_utc ? `Data processed ${data.meta.generated_utc} UTC.` : '';
renderLegend(document.getElementById('legend'), color);
const setTitle = (key, text) => { document.querySelector(`[data-title="${key}"]`).textContent = text; };
const chartIn = (id, label) => makeChart(document.getElementById(id), { label });
const hover = (sel, fn) => sel
  .on('pointerenter pointermove', (event, d) => tooltip.show(event, fn(d)))
  .on('pointerleave', () => tooltip.hide());
const modelTip = (m, extra = []) => ({
  title: m.id,
  sub: m.institution,
  rows: [{ value: fmtTcr(m.tcr), label: 'sensitivity (TCR)', color: color(m.tcr), dot: true }, ...extra],
});

// ---- Dataset facts -------------------------------------------------------------------------
const facts = [
  ['Models', `${data.models.length} climate models with every run we need`],
  ['Variable', 'Monthly near-surface air temperature (tas)'],
  ['Experiments', 'Pre-industrial control, 1%-per-year CO2 increase, historical, SSP1-2.6, SSP2-4.5, SSP5-8.5'],
  ['Years', '1850 to 2014 historical, 2015 to 2100 scenarios'],
  ['We compute', 'Sensitivity (TCR), 2081 to 2100 warming, the year each warming level is reached, Arctic warming'],
  ['Source', 'CMIP6 public archive on Google Cloud (gs://cmip6)'],
];
const dl = d3.select('#facts');
facts.forEach(([k, v]) => { dl.append('dt').text(k); dl.append('dd').text(v); });

// ---- 1. Spread --------------------------------------------------------------------------------
{
  const f = chartIn('c1', 'Global warming in every model, historical and SSP2-4.5');
  const { g, w, h } = f;
  const models = data.models.filter((m) => hasRun(m, SCEN)).sort((a, b) => a.tcr - b.tcr);
  const x = d3.scaleLinear().domain([1850, 2100]).range([0, w]);
  const y = d3.scaleLinear().domain([Math.min(-0.5, d3.min(models, (m) => d3.min(m.series[SCEN].global))),
    d3.max(models, (m) => d3.max(m.series[SCEN].global))]).nice().range([h, 0]);
  yAxis(g, w)(y);
  xAxis(g, h)(d3.axisBottom(x).tickValues([1850, 1900, 1950, 2000, 2050, 2100]).tickFormat(d3.format('d')));
  axisTitles(g, f, 'Year', 'Global warming (°C)');
  const line = d3.line().defined((d) => d != null).x((d, i) => x(years[i])).y((d) => y(d));
  hover(g.append('g').attr('fill', 'none').selectAll('path').data(models).join('path')
    .attr('d', (m) => line(m.series[SCEN].global)).attr('stroke', (m) => color(m.tcr)).attr('stroke-width', 1)
    .attr('opacity', 0.8), (m) => modelTip(m, [{ value: fmtC(m.warming[SCEN]), label: 'by 2081–2100' }]));
  const stats = ensembleByYear(models, SCEN, 'global', years.length);
  g.append('path').datum(stats).attr('fill', 'none').attr('stroke', pal.ink).attr('stroke-width', 2.25)
    .style('pointer-events', 'none')
    .attr('d', d3.line().defined((d) => d).x((d, i) => x(years[i])).y((d) => y(d.mean)));
  const mean = d3.mean(models, (m) => m.warming[SCEN]);
  const endY = y(stats[idx(2100)].mean);
  g.append('text').attr('class', 'label-strong').attr('x', w + 8).attr('y', endY + 4).text(fmtC(mean));
  g.append('text').attr('class', 'label-muted').attr('x', w + 8).attr('y', endY + 17).text('average');
  const [lo, hi] = d3.extent(models, (m) => m.warming[SCEN]);
  setTitle('c1', `Models agree on the past, then fan out: ${fmtC(lo)} to ${fmtC(hi)} by 2081–⁠2100`);
}

// ---- 2. Sources of uncertainty ----------------------------------------------------------------
{
  const scens = ['ssp126', 'ssp245', 'ssp585'];
  const models = data.models.filter((m) => scens.every((s) => hasRun(m, s)));
  const popVar = (v) => { const m = d3.mean(v); return d3.mean(v, (a) => (a - m) ** 2) ?? 0; };
  const ref = idx(2005);   // the 20-year mean centered on 2005 covers 1995-2014, all historical
  const rows = d3.range(idx(2015), idx(2090) + 1).map((i) => {
    const per = scens.map((s) => models.map((m) => m.series[s].global_s[i] - m.series[s].global_s[ref])
      .filter(Number.isFinite));
    const modelVar = d3.mean(per, popVar);
    const scenVar = popVar(per.map((v) => d3.mean(v)));
    return { year: years[i], model: modelVar + scenVar ? modelVar / (modelVar + scenVar) : 1 };
  });
  const f = chartIn('c2', 'Share of the spread in projected warming from model disagreement versus emissions scenario');
  const { g, w, h } = f;
  const x = d3.scaleLinear().domain([2015, 2090]).range([0, w]);
  const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);
  yAxis(g, w, { format: (v) => String(Math.round(v * 100)) })(y);
  xAxis(g, h)(d3.axisBottom(x).ticks(7).tickFormat(d3.format('d')));
  axisTitles(g, f, 'Year', 'Share of the spread (%)');
  const curve = d3.curveMonotoneX;
  g.append('path').datum(rows).attr('fill', pal['cat-a']).attr('fill-opacity', 0.3)
    .attr('d', d3.area().x((d) => x(d.year)).y0(h).y1((d) => y(d.model)).curve(curve));
  g.append('path').datum(rows).attr('fill', pal['cat-b']).attr('fill-opacity', 0.3)
    .attr('d', d3.area().x((d) => x(d.year)).y0((d) => y(d.model)).y1(0).curve(curve));
  g.append('path').datum(rows).attr('fill', 'none').attr('stroke', pal.bg).attr('stroke-width', 2)
    .attr('d', d3.line().x((d) => x(d.year)).y((d) => y(d.model)).curve(curve));
  const at = (yr) => rows.find((d) => d.year === yr) ?? rows[0];
  g.append('text').attr('class', 'label').attr('x', x(2020)).attr('y', y(at(2020).model / 2) + 4).text('Which model you trust');
  g.append('text').attr('class', 'label').attr('x', x(2088)).attr('y', y((1 + at(2088).model) / 2) + 4)
    .attr('text-anchor', 'end').text('Which emissions path');
  const cross = rows.find((d) => d.model < 0.5);
  if (cross) {
    g.append('line').attr('class', 'ref').attr('x1', x(cross.year)).attr('x2', x(cross.year)).attr('y1', 0).attr('y2', h);
    g.append('text').attr('class', 'label halo').attr('x', x(cross.year)).attr('y', -8).attr('text-anchor', 'middle')
      .text(String(cross.year));
  }
  setTitle('c2', cross
    ? `Until about ${cross.year}, which model you trust matters more than which emissions path we take`
    : 'Through 2090, which model you trust matters more than which emissions path we take');
}

// ---- 3. Sensitivity vs. future warming --------------------------------------------------------------
{
  const f = chartIn('c3', 'Scatter of sensitivity against warming by 2081 to 2100 under SSP2-4.5');
  const { g, w, h } = f;
  const pts = data.models.filter((m) => m.warming[SCEN] != null);
  const x = d3.scaleLinear().domain([1.1, Math.max(3.1, d3.max(pts, (m) => m.tcr) + 0.08)]).range([0, w]);
  const y = d3.scaleLinear().domain([0, d3.max(pts, (m) => m.warming[SCEN]) * 1.08]).nice().range([h, 0]);
  g.append('rect').attr('class', 'wash').attr('x', x(LIKELY[0])).attr('width', x(LIKELY[1]) - x(LIKELY[0])).attr('y', 0).attr('height', h);
  g.append('text').attr('class', 'label-muted').attr('x', (x(LIKELY[0]) + x(LIKELY[1])) / 2).attr('y', -8)
    .attr('text-anchor', 'middle').text('IPCC likely range');
  yAxis(g, w)(y);
  xAxis(g, h)(d3.axisBottom(x).ticks(8).tickFormat(d3.format('.1f')));
  axisTitles(g, f, 'Sensitivity, TCR (°C)', 'Warming by 2081–2100 (°C)');
  const fit = ols(pts.map((m) => ({ x: m.tcr, y: m.warming[SCEN] })));
  const [x0, x1] = d3.extent(pts, (m) => m.tcr);
  g.append('line').attr('x1', x(x0)).attr('x2', x(x1)).attr('y1', y(fit.intercept + fit.slope * x0))
    .attr('y2', y(fit.intercept + fit.slope * x1)).attr('stroke', pal.muted).attr('stroke-width', 1);
  hover(g.append('g').selectAll('circle').data(pts).join('circle')
    .attr('cx', (m) => x(m.tcr)).attr('cy', (m) => y(m.warming[SCEN])).attr('r', 5)
    .attr('fill', (m) => color(m.tcr)).attr('stroke', pal.bg).attr('stroke-width', 1.5),
  (m) => modelTip(m, [{ value: fmtC(m.warming[SCEN]), label: 'by 2081–2100' }]));
  const hot = data.models.filter((m) => m.tcr > LIKELY[1]).length;
  const r = fit.r.toFixed(2);
  const link = fit.r >= 0.7 ? 'sensitivity predicts warming' : fit.r >= 0.4 ? 'sensitivity partly predicts warming'
    : 'sensitivity barely predicts warming';
  setTitle('c3', `${hot} of ${data.models.length} models are above the IPCC's likely range, and ${link} (r = ${r})`);
}

// ---- 4. The forecast without the hot models --------------------------------------------------------
{
  const scens = [['ssp126', 'SSP1-2.6', 'low emissions'], ['ssp245', 'SSP2-4.5', 'middle of the road'],
    ['ssp585', 'SSP5-8.5', 'very high emissions']];
  const inRange = (m) => m.tcr >= LIKELY[0] && m.tcr <= LIKELY[1];
  const summary = (list, s) => {
    const v = list.map((m) => m.warming[s]).filter((d) => d != null).sort(d3.ascending);
    return v.length ? { n: v.length, lo: d3.quantileSorted(v, 0.05), hi: d3.quantileSorted(v, 0.95), mean: d3.mean(v) } : null;
  };
  const rows = scens.map(([id, label, desc]) => ({
    id, label, desc, all: summary(data.models, id), ipcc: summary(data.models.filter(inRange), id),
  })).filter((d) => d.all && d.ipcc);
  const f = chartIn('c4', 'Range of warming by 2081 to 2100 in each scenario: all models versus only the models inside the IPCC likely range');
  const { g, w, h } = f;
  const x = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.all.hi) * 1.04]).nice().range([0, w]);
  const yb = d3.scaleBand().domain(rows.map((d) => d.id)).range([16, h]).paddingInner(0.22).paddingOuter(0.06);
  g.append('g').attr('class', 'grid').call(d3.axisBottom(x).ticks(6).tickSize(h).tickFormat(''));
  xAxis(g, h)(d3.axisBottom(x).ticks(6).tickFormat(d3.format('d')));
  axisTitles(g, f, 'Warming by 2081–2100 (°C)', 'Emissions scenario');
  const kinds = [
    { key: 'all', name: 'all models', fill: pal.muted, cls: 'label-muted', dy: 0.52 },
    { key: 'ipcc', name: 'only models in the IPCC likely range', fill: pal.ink, cls: 'label-strong', dy: 0.84 },
  ];
  rows.forEach((row) => {
    const top = yb(row.id);
    g.append('text').attr('class', 'label').attr('x', 0).attr('y', top + 11)
      .text(`${row.label}, ${row.desc}`);
    kinds.forEach((k) => {
      const s = row[k.key], cy = top + yb.bandwidth() * k.dy;
      g.append('rect').attr('x', x(s.lo)).attr('width', Math.max(1, x(s.hi) - x(s.lo))).attr('y', cy - 3).attr('height', 6)
        .attr('rx', 3).attr('fill', k.fill);
      g.append('circle').attr('cx', x(s.mean)).attr('cy', cy).attr('r', 4.5)
        .attr('fill', pal.bg).attr('stroke', k.fill).attr('stroke-width', 2);
      g.append('text').attr('class', k.cls).attr('x', x(s.hi) + 8).attr('y', cy + 4).text(fmtC(s.hi));
      hover(g.append('rect').attr('x', x(s.lo) - 6).attr('width', x(s.hi) - x(s.lo) + 12).attr('y', cy - 9).attr('height', 18)
        .attr('fill', 'transparent').datum(s), () => ({
        title: `${row.label}, ${k.name}`,
        rows: [
          { value: `${fmtC(s.lo)} to ${fmtC(s.hi)}`, label: 'middle 90%', color: k.fill },
          { value: fmtC(s.mean), label: 'average' },
          { value: String(s.n), label: 'models' },
        ],
      }));
    });
  });
  // Key, drawn with the same marks as the chart.
  let kx = 0;
  kinds.forEach((k) => {
    g.append('rect').attr('x', kx).attr('y', -1).attr('width', 16).attr('height', 6).attr('rx', 3).attr('fill', k.fill);
    const t = g.append('text').attr('class', 'label-muted').attr('x', kx + 22).attr('y', 6).text(k.name);
    kx += 22 + t.node().getComputedTextLength() + 18;
  });
  const top = rows.find((d) => d.id === 'ssp585') ?? rows[rows.length - 1];
  const dropHi = top.all.hi - top.ipcc.hi, moveLo = Math.abs(top.all.lo - top.ipcc.lo);
  setTitle('c4', dropHi > 0.1 && moveLo < dropHi / 4
    ? `Without the hot models, the top of the ${top.label} range drops from ${fmtC(top.all.hi)} to ${fmtC(top.ipcc.hi)}, `
      + 'while the bottom barely moves'
    : `Without the hot models, the ${top.label} average goes from ${fmtC(top.all.mean)} to ${fmtC(top.ipcc.mean)}`);
}

// ---- 5. Arrival at +2°C ------------------------------------------------------------------------------
{
  const f = chartIn('c5', 'Year each model reaches 2 degrees of global warming, models sorted by sensitivity');
  const { g, w, h } = f;
  const rows = data.models.filter((m) => hasRun(m, SCEN));
  const cross = (m) => m.crossing[SCEN]?.['2'] ?? null;
  const yrs = rows.map(cross).filter((v) => v != null);
  const x = d3.scaleLinear().domain([Math.floor(Math.min(2000, d3.min(yrs) - 2) / 10) * 10, 2100]).range([0, w]);
  const yb = d3.scaleBand().domain(rows.map((m) => m.id)).range([0, h]);
  const cy = (m) => yb(m.id) + yb.bandwidth() / 2;
  const later = w + 30;
  const likely = rows.filter((m) => m.tcr >= LIKELY[0] && m.tcr <= LIKELY[1]);
  const taken = [];
  if (likely.length) {
    const top = yb(likely[0].id), bottom = yb(likely[likely.length - 1].id) + yb.bandwidth();
    g.append('rect').attr('class', 'wash').attr('x', 0).attr('width', w).attr('y', top).attr('height', bottom - top);
    taken.push(textBox(g.append('text').attr('class', 'label-muted').attr('x', 6).attr('y', bottom - 6)
      .attr('text-anchor', 'start').text('IPCC likely range')));
  }
  g.append('g').attr('class', 'grid').call(d3.axisBottom(x).ticks(6).tickSize(h).tickFormat(''));
  xAxis(g, h)(d3.axisBottom(x).ticks(6).tickFormat(d3.format('d')));
  axisTitles(g, f, 'Year', 'Models, most sensitive at top');
  g.append('text').attr('class', 'label-muted').attr('x', later).attr('y', -8).attr('text-anchor', 'middle').text('after 2100');
  const groups = [rows.filter((m) => m.tcr > LIKELY[1]), rows.filter((m) => m.tcr <= LIKELY[1])].map((grp) => ({
    grp, median: medianYear(grp.map((m) => cross(m) ?? Infinity)),
  }));
  const dotsAt = rows.map((m) => [cross(m) != null ? x(cross(m)) : later, cy(m)]);
  groups.forEach(({ grp, median }) => {
    if (median == null || !grp.length) return;
    const top = yb(grp[0].id), bottom = yb(grp[grp.length - 1].id) + yb.bandwidth();
    const mx = Number.isFinite(median) ? x(median) : later;
    g.append('line').attr('x1', mx).attr('x2', mx).attr('y1', top + 1).attr('y2', bottom - 1)
      .attr('stroke', pal.ink).attr('stroke-width', 1.25);
    // Beside the line, in the first row (from the top) where the label covers no dot or other label.
    const label = g.append('text').attr('class', 'label-strong halo')
      .text(Number.isFinite(median) ? String(Math.round(median)) : 'after 2100');
    const sides = Number.isFinite(median) ? [[5, 'start'], [-5, 'end']] : [[-9, 'end']];
    const spot = placeLabel(grp.flatMap((m) => sides.map(([dx, anchor]) => ({ x: mx + dx, y: cy(m) + 4, anchor }))),
      label.node().getComputedTextLength(), { dots: dotsAt, boxes: taken });
    label.attr('x', spot.x).attr('y', spot.y).attr('text-anchor', spot.anchor);
  });
  hover(g.append('g').selectAll('circle').data(rows).join('circle')
    .attr('cx', (m) => (cross(m) != null ? x(cross(m)) : later)).attr('cy', cy).attr('r', 4)
    .attr('fill', (m) => (cross(m) != null ? color(m.tcr) : pal.bg))
    .attr('stroke', (m) => (cross(m) != null ? pal.bg : color(m.tcr))).attr('stroke-width', 1.5),
  (m) => modelTip(m, [{ value: String(cross(m) ?? 'after 2100'), label: 'reaches +2°C' }]));
  // Use the same rounded medians the chart labels show, so the gap matches what readers can check.
  const [hot, rest] = groups.map((d) => (Number.isFinite(d.median) ? Math.round(d.median) : d.median));
  setTitle('c5', Number.isFinite(hot) && Number.isFinite(rest)
    ? `Models above the IPCC range reach +2°C about ${rest - hot} years sooner`
    : Number.isFinite(hot) ? 'Models above the IPCC range reach +2°C this century; most others do not'
      : 'When each model reaches +2°C');
}

// ---- 6. Same year or same warming? (Arctic) ---------------------------------------------------------------
{
  const tvp = timingVsPattern(data.models, SCEN, 'arctic_s', 2);
  const f = chartIn('c6', 'Arctic warming in each model in the same year versus at the same global warming');
  const { g, w, h } = f;
  if (tvp.yearIndex >= 0 && tvp.enough) {
    const rows = tvp.reach.map((r, j) => ({ m: r.m, byYear: tvp.atYear[j], byLevel: tvp.atLevel[j] }))
      .sort((a, b) => b.m.tcr - a.m.tcr);
    const x = d3.scaleLinear().domain(d3.extent(rows.flatMap((d) => [d.byYear, d.byLevel]))).nice().range([0, w]);
    const yb = d3.scaleBand().domain(rows.map((d) => d.m.id)).range([16, h]);
    const cy = (d) => yb(d.m.id) + yb.bandwidth() / 2;
    g.append('g').attr('class', 'grid').call(d3.axisBottom(x).ticks(6).tickSize(h).tickFormat(''));
    xAxis(g, h)(d3.axisBottom(x).ticks(6).tickFormat(d3.format('.1~f')));
    axisTitles(g, f, 'Arctic warming (°C)', 'Models, most sensitive at top');
    g.append('g').selectAll('line').data(rows).join('line')
      .attr('x1', (d) => x(d.byYear)).attr('x2', (d) => x(d.byLevel)).attr('y1', cy).attr('y2', cy)
      .attr('stroke', pal.excluded).attr('stroke-width', 1.5);
    hover(g.append('g').selectAll('circle').data(rows).join('circle')
      .attr('cx', (d) => x(d.byYear)).attr('cy', cy).attr('r', 3.5)
      .attr('fill', pal.bg).attr('stroke', (d) => color(d.m.tcr)).attr('stroke-width', 1.5),
    (d) => modelTip(d.m, [{ value: fmtC(d.byYear), label: `Arctic in ${years[tvp.yearIndex]}` }]));
    hover(g.append('g').selectAll('circle').data(rows).join('circle')
      .attr('cx', (d) => x(d.byLevel)).attr('cy', cy).attr('r', 3.5)
      .attr('fill', (d) => color(d.m.tcr)).attr('stroke', pal.bg).attr('stroke-width', 1),
    (d) => modelTip(d.m, [{ value: fmtC(d.byLevel), label: 'Arctic at +2°C global' }]));
    // Key, drawn with the same marks as the chart.
    g.append('circle').attr('cx', 4).attr('cy', 2).attr('r', 3.5).attr('fill', pal.bg).attr('stroke', pal.muted).attr('stroke-width', 1.5);
    g.append('text').attr('class', 'label-muted').attr('x', 12).attr('y', 6).text(`same year (${years[tvp.yearIndex]})`);
    g.append('circle').attr('cx', 132).attr('cy', 2).attr('r', 3.5).attr('fill', pal.muted);
    g.append('text').attr('class', 'label-muted').attr('x', 140).attr('y', 6).text('same global warming (+2°C)');
    setTitle('c6', `Compared at the same global warming, the models' Arctic warming spans ${fmtAbsC(tvp.spreadLevel)}, `
      + `not ${fmtAbsC(tvp.spreadYear)}`);
  }
}
