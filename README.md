# Too Hot to Trust? (DSC 106, Project 3)

An interactive D3 visualization of CMIP6 climate models. A group of the newest models responds to CO₂ more
strongly than the IPCC considers likely. The page lets readers decide which models to trust, shows how much that
changes projected warming, and tests whether the "hot" models describe a different world or the same world
reached sooner.

**Question:** Is CMIP6's scariest future driven by models that run too hot, and does that change what a warmer
world looks like, or only when we get there?

**Live site:** <https://da0t.github.io/dsc106-project3/> (exploratory graphs:
<https://da0t.github.io/dsc106-project3/checkpoint.html>)

| Page | What it is |
|---|---|
| `index.html` | The interactive graphic (four linked views) and the write-up |
| `checkpoint.html` | Six exploratory graphs for the checkpoint video |

> **Data:** `data/models.json` and `data/series.json` hold the real CMIP6 numbers, built from the CMIP6 archive on
> Google Cloud by `pipeline/cmip6_pipeline.py` (the date is in the page footer). You only need Step 1 to rebuild
> them.

---

## Step 1 (optional): Rebuild the data

**In Google Colab:** open `pipeline/cmip6_pipeline.ipynb` in [Colab](https://colab.research.google.com)
(File → Upload notebook, or `https://colab.research.google.com/github/Da0t/dsc106-project3/blob/main/pipeline/cmip6_pipeline.ipynb`)
and choose **Runtime → Run all** (30 to 60 minutes). It asks once for Google Drive access, keeps finished models
there, and saves `models.json` and `series.json` to `My Drive/dsc106_project3_data/`. Copy them into `data/`.

**Faster, on any machine with Python:** `pip install -r pipeline/requirements.txt`, then

```bash
python tools/ci_pipeline.py plan                 # read the catalog, test one store
python tools/ci_pipeline.py shard 0 1            # process every model (or split: shard K N on N machines)
python tools/ci_pipeline.py merge data           # write data/models.json and data/series.json
```

Either way the run ends with a **Story check**: the correlation between sensitivity and warming, how much the IPCC
screen moves the average, the Arctic spread by year vs. by warming level, and the median year each group reaches
+2 °C. These are the numbers the pages show.

## Step 2: Preview on your computer

```bash
cd dsc106-project3
python -m http.server 8000
```

Then open <http://localhost:8000> and <http://localhost:8000/checkpoint.html>. Double-clicking `index.html`
will not work, because browsers block reading the JSON files from `file://`.

## Step 3: Publish on GitHub Pages

Already set up for this repository: **Settings → Pages** deploys branch `main` from `/ (root)`, and every push to
`main` updates <https://da0t.github.io/dsc106-project3/> within a minute or two. The "Source code" link in the
footer fills itself in from that address. For a fresh copy elsewhere: make the repository **public**, push this
folder as its root, and choose Source "Deploy from a branch", branch `main`, folder `/ (root)`.

## Deadlines (Fall 2026, from [dsc106.com](https://dsc106.com/projects/project3/))

| When | What |
|---|---|
| Tue 11/3 | Lecture: "How will Project 3 be graded?" Worth hearing before the final polish. |
| Thu 11/5, 11:59 PM | **Checkpoint video** on Gradescope (`checkpoint.html`, then `index.html` for progress) |
| Wed 11/11, 11:59 PM | **Final**: GitHub Pages URL on Gradescope (`index.html` is what gets graded) |
| Thu 11/19 | Project 3 peer review (1% of the course grade; details not posted yet) |

Project 3 is 14% of the course grade: 13% for the submission, 1% for peer review. Projects can use up to 2 slip
days and are not accepted more than 48 hours late, and late submissions may be left out of peer review.

## Checkpoint video (due Thu 11/5, 11:59 PM, mp4, 2:00 max, with voiceover)

1. Team name and members are in `js/team.js` (add the team name there if you have one).
2. Open the live `checkpoint.html`, follow `docs/VIDEO_SCRIPT.md` (the real numbers are already filled in), and
   finish on `index.html` for "current progress". The script covers the five items the course page asks for.
   Not every member has to appear in the video.
3. Record with sound:
   * **Mac:** Cmd+Shift+5 records a `.mov`. Convert it with `ffmpeg -i video.mov -c:v libx264 -c:a aac video.mp4`,
     or record in Zoom (a meeting by yourself, share screen, record to computer), which saves `.mp4` directly.
   * **Windows:** Win+G (Xbox Game Bar) records `.mp4`.
4. One teammate uploads on Gradescope and **adds every member** to the submission.

## Final submission checklist (Wed 11/11, 11:59 PM)

- [ ] The three "To be written by the team." lines in `index.html` replaced with your own write-up: why this
      question, design rationale (encodings, interactions, colors, alternatives considered) and development
      process (who did what, rough people-hours, what took the most time). Raw material: `docs/WRITEUP_NOTES.md`
- [ ] Repository is **public** and contains the **unobfuscated source code** and the notebook
- [ ] GitHub Pages serves the site from the root folder, and the URL works in a private browser window
- [ ] URL submitted on Gradescope with all members added
- [ ] Team feedback form (the syllabus makes it a required part of every team project)

---

## How the code is organized

```
index.html            interactive graphic + write-up
checkpoint.html       six exploratory graphs
css/style.css         all styling: one font, color and type tokens, light and dark themes, shared chart styles
fonts/                Libre Franklin (self-hosted, SIL Open Font License)
js/main.js            loads the data, holds the shared state, wires the toolbar and the four views
js/lib/core.js        data loading, constants, statistics, number formatting, the sensitivity color scale
js/lib/ui.js          state store, URL hash, tooltip, buttons, legend, data table, the shared chart frame
js/panels/screen.js   view 1: sensitivity vs. end-of-century warming, with the brush
js/panels/ensemble.js view 2: average and spread of the kept models, against all models
js/panels/whenwhat.js view 3: Arctic warming by year or by global warming level (animated switch)
js/panels/arrival.js  view 4: the year each model reaches +2 °C
js/checkpoint.js      the six exploratory graphs (titles are computed from the data)
js/team.js            team name and members for the checkpoint page
data/                 models.json and series.json, produced by the pipeline
pipeline/             cmip6_pipeline.py (the source), cmip6_pipeline.ipynb (generated for Colab), requirements.txt
tools/                ci_pipeline.py (runs the pipeline in parallel pieces), build_notebook.py, make_demo_data.py
                      (synthetic test data + pipeline tests)
docs/                 VIDEO_SCRIPT.md and WRITEUP_NOTES.md
```

**How the interaction works.** The toolbar has three controls (Scenario, Models, Compare by). Every control and
the brush write to one shared state (`scenario`, `screen`, `xMode`, `hover`) and every view redraws from it, so
the views always agree. `screen` is a range of sensitivity values; models outside it turn gray but are never
removed. "Compare by" moves each Arctic line's x-coordinates from the calendar year to that model's own smoothed
global warming; both versions of a line have the same points, so D3 can animate one into the other. Scenario,
selection and comparison mode are saved in the URL, so a copied link reopens the same view. Hovering a model in
any view highlights it in all of them. The warming level is fixed at +2 °C and the region at the Arctic; the
notebook also exports the tropics and Southern California if you ever want a region switch.

**Visual system.** One typeface (Libre Franklin) at a handful of sizes set as CSS variables, and one content
column whose edges every block shares. Every chart on both pages uses the same frame (`FRAME` in
`js/lib/ui.js`: 520 × 330 with identical margins) and the same axis and grid styles. Side-by-side charts share
grid rows (CSS subgrid), so their titles, notes, charts and captions line up even when one wraps to more lines.
On the main page each view has a question as its title, a one-line note on how to read it, and a caption with
the current finding in numbers. Color has one meaning everywhere: model sensitivity, blue to gray to red around the
IPCC best estimate. Dark mode uses its own checked colors, not an automatic inversion.

**Editing the pipeline.** `pipeline/cmip6_pipeline.py` is the source of truth. After editing it, run
`python tools/build_notebook.py` to regenerate the notebook, and `python tools/make_demo_data.py --test` to run
the pipeline end to end on synthetic CMIP6-shaped inputs (mixed calendars, ensemble members, grids, control
drift and branch times) and check that it recovers each fake model's known sensitivity. The test never writes into
`data/`.

## Course rules this follows (Fall 2026 Project 3 page and syllabus)

* **D3 only.** "You may use only D3.js for this project." Every chart is drawn with D3.js v7 (loaded from
  jsDelivr). No Vega-Lite, Plotly, Altair or other plotting library.
* **One listed dataset.** CMIP6 is one of the three allowed datasets. All data come from the CMIP6 public dataset
  on Google Cloud. The IPCC likely range for TCR (1.4 to 2.2 °C) appears only as a labeled reference value.
* **No server.** The page reads two static JSON files.
* **Readable source.** Nothing is minified; the pipeline notebook is in the repository.
* **Focused.** The course prefers "a tightly focused, well-implemented interactive graphic" to a sprawling one:
  one graphic, four linked views, three controls.

## Data credit

CMIP6 model output from the World Climate Research Programme's Coupled Model Intercomparison Project, accessed
through the Pangeo / Google Cloud public dataset (`gs://cmip6`). Please keep the modeling-center acknowledgment
on the page.
