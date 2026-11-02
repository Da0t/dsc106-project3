// Entry point: loads the data, holds the shared state and wires the toolbar to the four views.
import { loadData, SCENARIOS, PRESETS, LIKELY, presetFor, makeTcrColor, readPalette, fmtC } from './lib/core.js';
import { createStore, readHash, writeHash, createTooltip, buildSegmented, renderLegend, createTable } from './lib/ui.js';
import { createScreenPanel } from './panels/screen.js';
import { createEnsemblePanel } from './panels/ensemble.js';
import { createWhenWhatPanel } from './panels/whenwhat.js';
import { createArrivalPanel } from './panels/arrival.js';

const $ = (sel) => document.querySelector(sel);

let data;
try {
  data = await loadData();
} catch (err) {
  $('.views').insertAdjacentHTML('beforebegin', '<p class="banner" role="alert">Could not load the data files. '
    + 'Serve this folder with a local web server (for example: python -m http.server) instead of opening the file directly.</p>');
  throw err;
}

$('#demo-banner').hidden = !data.meta.demo;
fillText(data);
linkRepo();

const ctx = { data, tooltip: createTooltip(), color: makeTcrColor(), pal: readPalette() };
const defaults = { scenario: 'ssp245', screen: null, xMode: 'year', level: 2, region: 'arctic', hover: null, live: false, theme: 0 };
const store = createStore({ ...defaults, ...readHash() });
ctx.store = store;

const views = [
  createScreenPanel($('#view-screen'), ctx),
  createEnsemblePanel($('#view-ensemble'), ctx),
  createWhenWhatPanel($('#view-whenwhat'), ctx),
  createArrivalPanel($('#view-arrival'), ctx),
];
const table = createTable($('#data-table'), data);

const controls = [
  buildSegmented($('[data-control="scenario"]'), SCENARIOS, {
    isActive: (d, s) => d.id === s.scenario,
    onSelect: (d) => store.set({ scenario: d.id, live: false }),
  }),
  buildSegmented($('[data-control="screen"]'), PRESETS, {
    isActive: (d, s) => d.id === presetFor(s.screen),
    onSelect: (d) => store.set({ screen: d.range, live: false }),
  }),
  buildSegmented($('[data-control="xMode"]'), [{ id: 'year', label: 'Year' }, { id: 'gwl', label: 'Warming level' }], {
    isActive: (d, s) => d.id === s.xMode,
    onSelect: (d) => store.set({ xMode: d.id, live: false }),
  }),
];
renderLegend($('#legend'), ctx.color);

function refresh(state, prev) {
  for (const v of views) v.update(state, prev);
  const viewChanged = !prev || ['scenario', 'screen', 'xMode', 'theme'].some((k) => state[k] !== prev[k]);
  if (viewChanged) {
    for (const c of controls) c.update(state);
    table.update(state, ctx.color);
    if (!state.live) {
      writeHash(state);
      $('#sr-status').textContent = [...document.querySelectorAll('.view .caption')].map((c) => c.textContent).join(' ');
    }
  }
}
store.subscribe(refresh);
refresh(store.get(), null);

// Follow the system light/dark setting: colors are re-read from the CSS and every view redraws.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  ctx.color = makeTcrColor();
  ctx.pal = readPalette();
  renderLegend($('#legend'), ctx.color);
  store.set({ theme: Date.now() });
});

// Escape clears the selection.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && store.get().screen) store.set({ screen: null, live: false });
});

function fillText({ models, meta }) {
  const fill = (key, text) => document.querySelectorAll(`[data-fill="${key}"]`).forEach((el) => { el.textContent = text; });
  const hot = models.filter((m) => m.tcr > LIKELY[1]).length;
  fill('n-models', String(models.length));
  fill('n-hot', String(hot));
  const all = models.filter((m) => m.warming.ssp245 != null);
  const likely = all.filter((m) => m.tcr >= LIKELY[0] && m.tcr <= LIKELY[1]);
  if (likely.length && likely.length < all.length) {
    const avg = (list) => list.reduce((t, m) => t + m.warming.ssp245, 0) / list.length;
    const [a, b] = [fmtC(avg(all)), fmtC(avg(likely))];
    const change = a === b ? `stays at ${a}` : `${avg(likely) < avg(all) ? 'drops' : 'rises'} from ${a} to ${b}`;
    fill('dek-effect', 'Keep only the models inside the IPCC\'s range and the middle-of-the-road forecast '
      + `(SSP2-4.5) for 2081–⁠2100 ${change}.`);
  }
  fill('n-models-sentence', `The figure uses the ${models.length} models that provide all of these runs; the data table lists them.`);
  fill('generated', meta.generated_utc ? `Data processed ${meta.generated_utc} UTC.` : '');
}

function linkRepo() {
  const a = $('#repo-link');
  const host = location.hostname;
  if (a && host.endsWith('.github.io')) {
    const repo = location.pathname.split('/').filter(Boolean)[0];
    a.href = `https://github.com/${host.split('.')[0]}${repo ? `/${repo}` : ''}`;
  }
}
