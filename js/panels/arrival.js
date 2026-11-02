// View 4: one row per model, sorted by sensitivity, with a dot at the year its 20-year average global
// warming first reaches +2 °C.
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import { LIKELY, hasRun, isIncluded, groupOf, medianYear, fmtLevel, fmtTcr } from '../lib/core.js';
import { makeChart, xAxis, axisTitles, duration } from '../lib/ui.js';

export function createArrivalPanel(root, ctx) {
  const { data, store, tooltip } = ctx;
  const caption = root.querySelector('.caption');
  const rows = data.models;
  const frame = makeChart(root.querySelector('.chart'), {
    label: 'Dot plot of the year each model first reaches 2 degrees of global warming, models sorted by sensitivity.',
  });
  const { g, w, h } = frame;
  const x = d3.scaleLinear().range([0, w]);
  const yb = d3.scaleBand().domain(rows.map((m) => m.id)).range([0, h]);
  const cy = (m) => yb(m.id) + yb.bandwidth() / 2;
  const laterX = w + 30;
  let current = null;

  // Rows inside the IPCC likely range share the wash used for that range in view 1.
  const likely = rows.filter((m) => groupOf(m) === 'likely');
  if (likely.length) {
    const top = yb(likely[0].id), bottom = yb(likely[likely.length - 1].id) + yb.bandwidth();
    g.append('rect').attr('class', 'wash').attr('x', 0).attr('width', w).attr('y', top).attr('height', bottom - top);
    g.append('text').attr('class', 'label-muted').attr('x', 6).attr('y', bottom - 6).attr('text-anchor', 'start')
      .text('IPCC likely range');
  }
  const gGrid = g.append('g').attr('class', 'grid');
  const updateX = xAxis(g, h);
  axisTitles(g, frame, 'Year', 'Models, most sensitive at top');
  g.append('text').attr('class', 'label-muted').attr('x', laterX).attr('y', -8).attr('text-anchor', 'middle').text('after 2100');
  const gMedians = g.append('g').style('pointer-events', 'none');
  const gDots = g.append('g').style('pointer-events', 'none');
  const gFocus = g.append('g').style('pointer-events', 'none');

  g.append('g').selectAll('rect').data(rows, (m) => m.id).join('rect')
    .attr('x', 0).attr('width', w + 46).attr('y', (m) => yb(m.id)).attr('height', yb.bandwidth())
    .attr('fill', 'transparent')
    .on('pointerenter pointermove', (event, m) => {
      if (store.get().hover !== m.id) store.set({ hover: m.id });
      const state = store.get();
      const c = crossing(m, state);
      tooltip.show(event, {
        title: m.id,
        sub: m.institution,
        rows: [
          { value: c.status === 'year' ? String(c.year) : c.status === 'never' ? 'after 2100' : 'no run',
            label: `reaches ${fmtLevel(state.level)}`, color: ctx.color(m.tcr), dot: true },
          { value: fmtTcr(m.tcr), label: 'sensitivity (TCR)' },
        ],
      });
    })
    .on('pointerleave', () => { tooltip.hide(); store.set({ hover: null }); });

  function crossing(m, state) {
    if (!hasRun(m, state.scenario)) return { status: 'none' };
    const yr = m.crossing[state.scenario]?.[String(state.level)];
    return yr == null ? { status: 'never' } : { status: 'year', year: yr };
  }

  function render(state) {
    const dur = state.live ? 0 : duration(500);
    const items = rows.map((m) => ({ m, inc: isIncluded(m, state.screen), ...crossing(m, state) }));
    const yrs = items.filter((d) => d.status === 'year').map((d) => d.year);
    x.domain([Math.floor(Math.min(2000, (d3.min(yrs) ?? 2000) - 2) / 10) * 10, 2100]);
    updateX(d3.axisBottom(x).ticks(6).tickFormat(d3.format('d')), dur);
    gGrid.transition().duration(dur).call(d3.axisBottom(x).ticks(6).tickSize(h).tickFormat(''));

    const dots = items.filter((d) => d.status !== 'none');
    gDots.selectAll('circle').data(dots, (d) => d.m.id)
      .join((enter) => enter.append('circle').attr('r', 4).attr('cy', (d) => cy(d.m))
        .attr('cx', (d) => (d.status === 'year' ? x(d.year) : laterX)))
      .transition().duration(dur)
      .attr('cx', (d) => (d.status === 'year' ? x(d.year) : laterX))
      .attr('cy', (d) => cy(d.m))
      .attr('fill', (d) => (d.inc && d.status === 'year' ? ctx.color(d.m.tcr) : ctx.pal.bg))
      .attr('stroke', (d) => (!d.inc ? ctx.pal.excluded : d.status === 'year' ? ctx.pal.bg : ctx.color(d.m.tcr)))
      .attr('stroke-width', 1.5);

    // Median year for models above the IPCC range and for the rest, drawn across their own rows.
    const groups = [
      { key: 'hot', test: (m) => m.tcr > LIKELY[1] },
      { key: 'rest', test: (m) => m.tcr <= LIKELY[1] },
    ].map((grp) => {
      const members = items.filter((d) => grp.test(d.m) && d.inc && d.status !== 'none');
      const groupRows = items.filter((d) => grp.test(d.m));
      return {
        key: grp.key,
        median: medianYear(members.map((d) => (d.status === 'year' ? d.year : Infinity))),
        top: groupRows.length ? yb(groupRows[0].m.id) : 0,
        bottom: groupRows.length ? yb(groupRows[groupRows.length - 1].m.id) + yb.bandwidth() : 0,
      };
    });
    const med = gMedians.selectAll('g').data(groups.filter((d) => d.median != null), (d) => d.key)
      .join((enter) => {
        const e = enter.append('g');
        e.append('line').attr('stroke-width', 1.25);
        e.append('text').attr('class', 'label-strong halo').attr('text-anchor', 'start');
        return e;
      });
    const mx = (d) => (Number.isFinite(d.median) ? x(d.median) : laterX);
    med.select('line').attr('stroke', ctx.pal.ink).transition().duration(dur)
      .attr('x1', mx).attr('x2', mx).attr('y1', (d) => d.top + 1).attr('y2', (d) => d.bottom - 1);
    med.select('text').attr('text-anchor', (d) => (Number.isFinite(d.median) ? 'start' : 'end'))
      .transition().duration(dur)
      .attr('x', (d) => (Number.isFinite(d.median) ? mx(d) + 5 : mx(d) - 9)).attr('y', (d) => d.top + 11)
      .text((d) => (Number.isFinite(d.median) ? `${Math.round(d.median)}` : 'after 2100'));
    current = { items, groups };

    const [hot, rest] = groups;
    const kept = items.filter((d) => d.inc && d.status !== 'none');
    const level = fmtLevel(state.level);
    if (!kept.length) {
      caption.textContent = 'No models kept.';
    } else if (hot.median != null && rest.median != null) {
      const yr = (v) => (Number.isFinite(v) ? String(Math.round(v)) : 'after 2100');
      caption.textContent = `Median year to reach ${level}: ${yr(hot.median)} for models above the IPCC range, `
        + `${yr(rest.median)} for the rest.`;
    } else {
      const reached = kept.filter((d) => d.status === 'year').map((d) => d.year);
      caption.textContent = reached.length
        ? `The kept models reach ${level} between ${d3.min(reached)} and ${d3.max(reached)}.`
        : `None of the kept models reach ${level} by 2100.`;
    }
    highlight(state.hover);
  }

  function highlight(id) {
    gFocus.selectAll('*').remove();
    const d = id && current?.items.find((it) => it.m.id === id);
    if (!d || d.status === 'none') return;
    const cx = d.status === 'year' ? x(d.year) : laterX;
    gFocus.append('circle').attr('cx', cx).attr('cy', cy(d.m)).attr('r', 7.5)
      .attr('fill', 'none').attr('stroke', ctx.pal.ink).attr('stroke-width', 1.25);
    gFocus.append('text').attr('class', 'label-strong halo').attr('x', cx - 11).attr('y', cy(d.m) + 4)
      .attr('text-anchor', 'end').text(d.m.id);
  }

  return {
    update(state, prev) {
      const changed = (k) => !prev || state[k] !== prev[k];
      if (['scenario', 'screen', 'theme', 'level'].some(changed)) render(state);
      else if (changed('hover')) highlight(state.hover);
    },
  };
}
