# %% [markdown]
# # Too Hot to Trust? CMIP6 data pipeline (DSC 106, Project 3)
#
# This notebook reads the **CMIP6** climate-model archive from the public Google Cloud
# bucket (`gs://cmip6`, the dataset listed on the Project 3 page) and writes the two
# small JSON files the D3 site loads:
#
# * `data/models.json`: one record per model (sensitivity, end-of-century warming, warming-level years)
# * `data/series.json`: yearly global and regional warming curves, 1850-2100
#
# **How to run (Google Colab):** `Runtime > Run all`. The first run takes roughly
# 20-40 minutes for ~25 models. Colab asks once for access to your Google Drive: finished models
# are cached there, so a rerun after a disconnect is fast. At the end the two JSON files are saved to
# `My Drive/dsc106_project3_data/` and Colab downloads `project3_data.zip`; put the two files in the
# site's `data/` folder.
#
# **What it computes** (every step is also described on the website):
# 1. Global and regional means of monthly near-surface air temperature (`tas`), weighted by cos(latitude).
# 2. Calendar-year averages (complete years only).
# 3. **TCR** (transient climate response): warming averaged over years 61-80 of the idealized
#    `1pctCO2` run (CO2 doubles at year 70), minus the model's own `piControl` run over the same
#    years, after removing control-run drift with a straight-line fit.
# 4. Historical + SSP runs joined into one 1850-2100 curve and expressed relative to 1850-1900.
# 5. 2081-2100 average warming, a 20-year centered running mean, and the first year that running
#    mean reaches 1.5, 2, 3 and 4 °C (the IPCC "global warming level" convention).

# %%
# --- Setup -------------------------------------------------------------------------------
import importlib.util
import subprocess
import sys

IN_COLAB = "google.colab" in sys.modules
if IN_COLAB:  # Colab already has numpy/pandas/xarray; add the cloud readers if missing.
    _missing = [p for p in ("xarray", "zarr", "gcsfs", "cftime", "dask") if importlib.util.find_spec(p) is None]
    if _missing:
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", *_missing], check=False)

import json
import re
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

warnings.filterwarnings("ignore", category=xr.SerializationWarning)
warnings.filterwarnings("ignore", message=".*cftime.*")
warnings.filterwarnings("ignore", message=".*Mean of empty slice.*")

# %%
# --- Configuration -----------------------------------------------------------------------
CATALOG_URL = "https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv"
VARIABLE = "tas"   # near-surface (2 m) air temperature
TABLE = "Amon"     # monthly atmosphere output

REQUIRED_EXPERIMENTS = ["piControl", "1pctCO2", "historical", "ssp245", "ssp585"]
OPTIONAL_EXPERIMENTS = ["ssp126"]
SCENARIOS = ["ssp126", "ssp245", "ssp585"]

FIRST_YEAR, LAST_YEAR = 1850, 2100
HIST_LAST_YEAR = 2014
BASELINE = (1850, 1900)      # IPCC pre-industrial reference period
SMOOTH_YEARS = 20            # IPCC uses 20-year means for warming levels
THRESHOLDS = [1.5, 2.0, 3.0, 4.0]
TCR_YEARS = (61, 80)         # years of the 1pctCO2 run averaged for TCR (CO2 doubles at year 70)
RUN_YEARS = 150              # length of the 1pctCO2 run and of the control segment we read

# Regions: latitude band in degrees north, longitude band in degrees east (0-360) or None for all.
REGIONS = {
    "arctic":  {"name": "Arctic",              "lat": (66.5, 90.0),  "lon_east": None},
    "tropics": {"name": "Tropics",             "lat": (-23.5, 23.5), "lon_east": None},
    "socal":   {"name": "Southern California", "lat": (30.0, 36.0),  "lon_east": (236.0, 246.0)},  # 124°W-114°W
}

KEEP_CACHE_IN_DRIVE = True   # Colab only: keeps finished models and the final files in Google Drive (asks once)
MAX_MODELS = None      # e.g. 3 for a quick test run
ONLY_MODELS = None     # e.g. ["CanESM5", "MIROC6"]
SKIP_MODELS = []       # models to leave out on purpose
OUT_DIR = Path("data")
CACHE_DIR = Path("cache")
REFRESH_CACHE = False  # True recomputes every model instead of reusing cache/
DEMO = False           # True only when tools/make_demo_data.py feeds synthetic inputs

YEARS = np.arange(FIRST_YEAR, LAST_YEAR + 1)
HIST_AND_SCENARIOS = ["historical"] + SCENARIOS

if IN_COLAB and KEEP_CACHE_IN_DRIVE:
    from google.colab import drive
    drive.mount("/content/drive")
    CACHE_DIR = Path("/content/drive/MyDrive/dsc106_cmip6_cache")

# %% [markdown]
# ## 1. Find the runs in the catalog
# For each model we need all five required experiments. Historical and SSP runs must share one
# ensemble member (the SSPs continue that historical run). We take the lowest-numbered member
# that has all of them, so a model labelled `r1i1p1f2` (for example UKESM1-0-LL) is kept rather
# than silently dropped by a hard-coded `r1i1p1f1` filter. Native grids (`gn`) and the newest
# version are preferred.

# %%
_MEMBER = re.compile(r"r(\d+)i(\d+)p(\d+)f(\d+)$")


def member_key(member):
    """Sort key so r1i1p1f1 < r1i1p1f2 < r2i1p1f1 ..."""
    m = _MEMBER.search(str(member))
    return tuple(int(x) for x in m.groups()) if m else (10**6,) * 4


def load_catalog(url=CATALOG_URL):
    t0 = time.time()
    cat = pd.read_csv(url, dtype=str)
    keep = (
        (cat["variable_id"] == VARIABLE)
        & (cat["table_id"] == TABLE)
        & cat["experiment_id"].isin(REQUIRED_EXPERIMENTS + OPTIONAL_EXPERIMENTS)
    )
    cat = cat[keep].copy()
    print(f"Catalog: {len(cat):,} matching stores ({time.time() - t0:.0f}s)")
    return cat


def _best_row(rows, grid=None):
    """Prefer the given grid (else the native one), then the newest version."""
    if grid is not None and (rows["grid_label"] == grid).any():
        rows = rows[rows["grid_label"] == grid]
    rows = rows.assign(_not_native=(rows["grid_label"] != "gn").astype(int))
    rows = rows.sort_values(["_not_native", "version"], ascending=[True, False])
    return rows.iloc[0]


def select_runs(cat):
    plan = {}
    for source_id, g in cat.groupby("source_id"):
        if not set(REQUIRED_EXPERIMENTS) <= set(g["experiment_id"]):
            continue
        shared = set.intersection(*[set(g.loc[g["experiment_id"] == e, "member_id"])
                                    for e in ("historical", "ssp245", "ssp585")])
        if not shared:
            continue
        hist_member = min(shared, key=member_key)
        candidates = {}
        for exp in REQUIRED_EXPERIMENTS + OPTIONAL_EXPERIMENTS:
            rows = g[g["experiment_id"] == exp]
            if len(rows) and exp in HIST_AND_SCENARIOS:
                rows = rows[rows["member_id"] == hist_member]
            elif len(rows):
                rows = rows[rows["member_id"] == min(rows["member_id"], key=member_key)]
            if len(rows):
                candidates[exp] = rows
        # Use one grid for every run of a model when one exists (native first), so TCR and the
        # 2014/2015 join never mix global means computed on different grids.
        common = set.intersection(*[set(candidates[e]["grid_label"]) for e in REQUIRED_EXPERIMENTS])
        grid = "gn" if "gn" in common else (sorted(common)[0] if common else None)
        runs = {}
        for exp, rows in candidates.items():
            row = _best_row(rows, grid)
            runs[exp] = {"zstore": row["zstore"], "member": row["member_id"],
                         "grid": row["grid_label"], "version": str(row["version"])}
        plan[source_id] = {"institution": g["institution_id"].iloc[0], "runs": runs}
    return plan


def show_plan(plan):
    rows = [{"model": sid, "institution": p["institution"],
             "historical member": p["runs"]["historical"]["member"],
             "scenarios": ", ".join(s for s in SCENARIOS if s in p["runs"])}
            for sid, p in sorted(plan.items())]
    table = pd.DataFrame(rows)
    print(f"{len(table)} models have {VARIABLE} for {', '.join(REQUIRED_EXPERIMENTS)}")
    return table

# %% [markdown]
# ## 2. Read a run and reduce it to yearly global and regional averages

# %%
_GCS = None


def open_store(zstore):
    """Open one CMIP6 zarr store anonymously. Tries the course notebook's method first."""
    global _GCS
    import gcsfs
    if _GCS is None:
        _GCS = gcsfs.GCSFileSystem(token="anon")
    errors = []
    attempts = (
        lambda: xr.open_zarr(_GCS.get_mapper(zstore), consolidated=True),
        lambda: xr.open_zarr(zstore, storage_options={"token": "anon"}, consolidated=True),
        lambda: xr.open_zarr(zstore, storage_options={"token": "anon"}, consolidated=False),
    )
    for attempt in attempts:
        try:
            return attempt()
        except Exception as e:  # noqa: BLE001 (we report every failure)
            errors.append(f"{type(e).__name__}: {e}")
    raise IOError(f"Could not open {zstore}\n  " + "\n  ".join(errors))


def _tas(ds):
    da = ds[VARIABLE]
    rename = {a: b for a, b in (("latitude", "lat"), ("longitude", "lon")) if a in da.dims}
    if rename:
        da = da.rename(rename)
    if "lat" not in da.dims or "lon" not in da.dims or da["lat"].ndim != 1:
        raise ValueError("expected a regular lat/lon grid")
    return da


def _region_indices(lat, lon, spec):
    lat = np.asarray(lat, dtype=float)
    lon = np.asarray(lon, dtype=float) % 360
    lo, hi = spec["lat"]
    ilat = np.where((lat >= lo) & (lat <= hi))[0]
    if ilat.size == 0:  # very coarse grid: use the nearest row
        ilat = np.array([np.abs(lat - (lo + hi) / 2).argmin()])
    if spec["lon_east"] is None:
        ilon = np.arange(lon.size)
    else:
        a, b = spec["lon_east"]
        ilon = np.where((lon >= a) & (lon <= b))[0]
        if ilon.size == 0:
            centre = (a + b) / 2
            ilon = np.array([np.abs(((lon - centre + 180) % 360) - 180).argmin()])
    return ilat, ilon


def spatial_means(da):
    """cos(latitude)-weighted means: the globe plus each region (lazy until computed)."""
    weights = np.cos(np.deg2rad(da["lat"].astype("float64"))).clip(0)
    out = {"global": da.weighted(weights).mean(("lat", "lon"))}
    for key, spec in REGIONS.items():
        ilat, ilon = _region_indices(da["lat"].values, da["lon"].values, spec)
        sub = da.isel(lat=ilat, lon=ilon)
        out[key] = sub.weighted(weights.isel(lat=ilat)).mean(("lat", "lon"))
    return xr.Dataset(out)


def annual_means(monthly):
    """Monthly Dataset of time series -> DataFrame of calendar-year means (complete years only)."""
    monthly = monthly.reset_coords(drop=True)
    years = monthly["time"].dt.year
    grouped = monthly.groupby(years)
    means = grouped.mean().to_dataframe()
    counts = grouped.count().to_dataframe()
    means.index = means.index.astype(int)
    complete = (counts == 12).all(axis=1).to_numpy()
    return means[complete].astype("float64")


def load_series(ds, years=None, first_n_years=None):
    """Yearly global + regional means for one opened run."""
    da = _tas(ds)
    if years is not None:
        y = da["time"].dt.year.values
        da = da.isel(time=np.where((y >= years[0]) & (y <= years[1]))[0])
    if first_n_years is not None:
        da = da.isel(time=slice(0, 12 * first_n_years))
    if da.sizes["time"] == 0:
        raise ValueError("no data in the requested years")
    return annual_means(spatial_means(da).compute())

# %% [markdown]
# ## 3. Transient climate response (TCR)
# The control run tells us what the model does with no added CO2. We read the 150 control
# years that run alongside the 1pctCO2 experiment (using the branch time stored in the
# 1pctCO2 metadata), fit a straight line to remove slow drift, and subtract it.

# %%
def _calendar(ds):
    cal = ds["time"].encoding.get("calendar")
    if not cal:
        try:
            cal = ds["time"].dt.calendar
        except Exception:  # noqa: BLE001
            cal = None
    return str(cal or "standard")


def branch_year(child_attrs, parent_ds):
    """Calendar year in the parent (control) run where the child run branched off."""
    try:
        import cftime
        value = child_attrs.get("branch_time_in_parent")
        units = child_attrs.get("parent_time_units")
        if value is None or not units:
            return None
        if isinstance(value, (list, tuple, np.ndarray)):
            value = value[0]
        return int(cftime.num2date(float(value), str(units), calendar=_calendar(parent_ds)).year)
    except Exception:  # noqa: BLE001
        return None


def compute_tcr(runs):
    pct_ds = open_store(runs["1pctCO2"]["zstore"])
    pct = load_series(pct_ds, first_n_years=RUN_YEARS)["global"].to_numpy()
    if pct.size < TCR_YEARS[1]:
        raise ValueError("1pctCO2 run is shorter than 80 years")

    pi_ds = open_store(runs["piControl"]["zstore"])
    pi_years = pi_ds["time"].dt.year.values
    start = branch_year(pct_ds.attrs, pi_ds)
    method = "branch-aligned control years, linear drift removed"
    if start is None or start < pi_years.min() or start + TCR_YEARS[1] > pi_years.max():
        start = int(pi_years.min())
        method = "first control years (no usable branch time), linear drift removed"
    control = load_series(pi_ds, years=(start, start + RUN_YEARS - 1))["global"]
    if control.size < 30:
        raise ValueError("control run too short")

    t = (control.index.to_numpy() - start).astype(float)
    slope, intercept = np.polyfit(t, control.to_numpy(), 1)
    k = np.arange(TCR_YEARS[0] - 1, TCR_YEARS[1])           # 0-based years 60..79
    tcr = float(pct[k].mean() - (intercept + slope * k).mean())
    return tcr, method, float(slope * 100)

# %% [markdown]
# ## 4. Historical + scenario warming curves

# %%
def build_scenarios(hist, ssps):
    """Join historical + each SSP; anomalies vs 1850-1900; 20-year centered running mean."""
    out = {}
    for scen, future in ssps.items():
        joined = pd.concat([hist, future])
        joined = joined[~joined.index.duplicated(keep="first")].reindex(YEARS)
        anomaly = joined - joined.loc[BASELINE[0]:BASELINE[1]].mean()
        smooth = anomaly.rolling(SMOOTH_YEARS, center=True, min_periods=SMOOTH_YEARS).mean()
        out[scen] = (anomaly, smooth)
    return out


def crossing_years(smooth_global):
    """First year the 20-year running mean reaches each threshold (None if never by 2100)."""
    out = {}
    for thr in THRESHOLDS:
        hit = smooth_global[smooth_global >= thr]
        out[f"{thr:g}"] = int(hit.index[0]) if len(hit) else None
    return out


def _as_list(series, digits=3):
    return [None if not np.isfinite(v) else round(float(v), digits) for v in series.to_numpy()]

# %% [markdown]
# ## 5. Process every model (cached)

# %%
def process_model(source_id, info):
    runs = info["runs"]
    t0 = time.time()
    tcr, tcr_method, drift = compute_tcr(runs)
    hist = load_series(open_store(runs["historical"]["zstore"]), years=(FIRST_YEAR, HIST_LAST_YEAR))
    ssps = {s: load_series(open_store(runs[s]["zstore"]), years=(HIST_LAST_YEAR + 1, LAST_YEAR))
            for s in SCENARIOS if s in runs}
    curves = build_scenarios(hist, ssps)

    record = {
        "id": source_id,
        "institution": info["institution"],
        "tcr": round(tcr, 3),
        "tcr_method": tcr_method,
        "control_drift_per_century": round(drift, 3),
        "members": {exp: r["member"] for exp, r in runs.items()},
        "grids": sorted({r["grid"] for r in runs.values()}),
        "scenarios": list(curves),
        "warming_2081_2100": {},
        "crossing": {},
    }
    series = {}
    for scen, (anomaly, smooth) in curves.items():
        window = anomaly.loc[2081:2100, "global"].dropna()
        record["warming_2081_2100"][scen] = round(float(window.mean()), 3) if len(window) >= 15 else None
        record["crossing"][scen] = crossing_years(smooth["global"])
        series[scen] = {"global": _as_list(anomaly["global"]), "global_s": _as_list(smooth["global"])}
        for key in REGIONS:
            series[scen][f"{key}_s"] = _as_list(smooth[key])
    print(f"    TCR {tcr:.2f} °C | {', '.join(curves)} | {time.time() - t0:.0f}s")
    return record, series


def run_all(plan):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ids = sorted(plan)
    if ONLY_MODELS:
        ids = [i for i in ids if i in ONLY_MODELS]
    ids = [i for i in ids if i not in SKIP_MODELS]
    if MAX_MODELS:
        ids = ids[:MAX_MODELS]
    records, series, failures = [], {}, {}
    t0 = time.time()
    for n, sid in enumerate(ids, 1):
        print(f"[{n}/{len(ids)}] {sid}")
        cache = CACHE_DIR / f"{sid}.json"
        if cache.exists() and not REFRESH_CACHE:
            blob = json.loads(cache.read_text())
            records.append(blob["record"])
            series[sid] = blob["series"]
            print("    (cached)")
            continue
        try:
            record, curves = process_model(sid, plan[sid])
        except Exception as e:  # noqa: BLE001 (one bad store should not stop the run)
            failures[sid] = f"{type(e).__name__}: {str(e)[:300]}"
            print("    skipped:", failures[sid])
            continue
        cache.write_text(json.dumps({"record": record, "series": curves}))
        records.append(record)
        series[sid] = curves
    print(f"\nDone: {len(records)} models processed, {len(failures)} skipped, {(time.time() - t0) / 60:.1f} min")
    return records, series, failures

# %% [markdown]
# ## 6. Export the JSON files and check the story

# %%
def export(records, series, failures, out_dir=None, demo=None):
    out_dir = Path(out_dir or OUT_DIR)
    demo = DEMO if demo is None else demo
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = {
        "title": "Too Hot to Trust? CMIP6 data for DSC 106 Project 3",
        "generated_utc": pd.Timestamp.now("UTC").strftime("%Y-%m-%d %H:%M"),
        "demo": bool(demo),
        "source": "CMIP6 (World Climate Research Programme) via the public Google Cloud bucket gs://cmip6",
        "catalog": CATALOG_URL,
        "variable": f"{VARIABLE} ({TABLE}): monthly near-surface air temperature",
        "baseline": list(BASELINE),
        "smooth_years": SMOOTH_YEARS,
        "thresholds": THRESHOLDS,
        "tcr_years": list(TCR_YEARS),
        "scenarios": SCENARIOS,
        "regions": {k: {"name": v["name"], "lat": list(v["lat"]),
                        "lon_east": list(v["lon_east"]) if v["lon_east"] else None}
                    for k, v in REGIONS.items()},
        "n_models": len(records),
        "skipped": failures,
    }
    models = sorted(records, key=lambda r: -r["tcr"])
    (out_dir / "models.json").write_text(json.dumps({"meta": meta, "models": models}, indent=1))
    (out_dir / "series.json").write_text(
        json.dumps({"years": YEARS.tolist(), "series": {r["id"]: series[r["id"]] for r in models}},
                   separators=(",", ":")))
    sizes = ", ".join(f"{p.name} {p.stat().st_size / 1024:.0f} KB" for p in sorted(out_dir.glob("*.json")))
    print(f"Wrote {sizes} to {out_dir.resolve()}")


def _spread(values):
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    if values.size < 2:
        return float("nan")
    return float(np.percentile(values, 95) - np.percentile(values, 5))


def story_check(records, series, scenario="ssp245", level=2.0, likely=(1.4, 2.2)):
    """Prints the numbers the website will show, so the team can confirm the story holds."""
    rows = [r for r in records if r["warming_2081_2100"].get(scenario) is not None]
    if len(rows) < 3:
        print("Not enough models for a story check.")
        return {}
    tcr = np.array([r["tcr"] for r in rows])
    warm = np.array([r["warming_2081_2100"][scenario] for r in rows])
    r_val = float(np.corrcoef(tcr, warm)[0, 1])
    inside = (tcr >= likely[0]) & (tcr <= likely[1])
    hot = tcr > likely[1]
    print(f"Story check: {scenario.upper()}, {len(rows)} models\n")
    print(f"1) Sensitivity predicts the future: r = {r_val:.2f} between TCR and 2081-2100 warming")
    print(f"   {hot.sum()} models above the IPCC likely TCR range, {inside.sum()} inside, "
          f"{(tcr < likely[0]).sum()} below")
    if inside.any():
        print(f"2) Screening to the likely range: {warm.mean():.2f} °C (all) -> {warm[inside].mean():.2f} °C "
              f"({warm[inside].mean() - warm.mean():+.2f} °C)")

    gl = np.array([series[r["id"]][scenario]["global_s"] for r in rows], dtype=float)
    first = [int(np.argmax(g >= level)) if np.nanmax(g) >= level else None for g in gl]
    reach = [i for i, f in enumerate(first) if f is not None]
    mean_curve = np.nanmean(gl, axis=0)                 # average of ALL models, as on the site
    enough = len(reach) >= 3 and len(reach) >= 2 / 3 * len(rows)
    out = {"r": r_val}
    if enough and np.nanmax(mean_curve) >= level:
        y_idx = int(np.argmax(mean_curve >= level))
        print(f"3) Timing vs. pattern: the average model reaches +{level:g} °C in {YEARS[y_idx]}")
        for key, spec in REGIONS.items():
            rg = np.array([series[rows[i]["id"]][scenario][f"{key}_s"] for i in reach], dtype=float)
            by_year = _spread(rg[:, y_idx])
            by_level = _spread([rg[j, first[i]] for j, i in enumerate(reach)])
            share = (by_year - by_level) / by_year if by_year > 0 else float("nan")
            print(f"   {spec['name']:<20} spread {by_year:.2f} °C in {YEARS[y_idx]} vs {by_level:.2f} °C "
                  f"lined up at +{level:g} °C ({share:.0%} of the disagreement was timing)")
    # Models that never reach the level count as "after 2100" (infinity) in the median, as on the site.
    years = np.array([r["crossing"][scenario][f"{level:g}"] or np.inf for r in rows], dtype=float)
    if hot.any() and (~hot).any():
        fmt = lambda v: "after 2100" if not np.isfinite(v) else f"{v:.0f}"
        print(f"4) Median year reaching +{level:g} °C: hot models {fmt(np.median(years[hot]))}, "
              f"the rest {fmt(np.median(years[~hot]))}")
    print("\nIf r is weak or the screen barely moves the mean, tell the team before recording.")
    return out


def smoke_test(plan):
    """Open one store before the long loop so environment problems show up in seconds."""
    sid = sorted(plan)[0]
    ds = open_store(plan[sid]["runs"]["historical"]["zstore"])
    print(f"Opened {sid} historical: {dict(ds[VARIABLE].sizes)}, calendar {_calendar(ds)}")

# %% [markdown]
# ## 7. Run it
# Set `MAX_MODELS = 3` in the configuration cell for a quick trial, then set it back to `None`.

# %%
if __name__ == "__main__":
    catalog = load_catalog()
    plan = select_runs(catalog)
    plan_table = show_plan(plan)
    print(plan_table.to_string(index=False))
    smoke_test(plan)

# %%
if __name__ == "__main__":
    records, series, failures = run_all(plan)

# %%
if __name__ == "__main__":
    export(records, series, failures)
    story = story_check(records, series)
    if IN_COLAB and KEEP_CACHE_IN_DRIVE:  # a copy that survives the Colab session
        import shutil
        drive_out = Path("/content/drive/MyDrive/dsc106_project3_data")
        drive_out.mkdir(parents=True, exist_ok=True)
        for name in ("models.json", "series.json"):
            shutil.copy(OUT_DIR / name, drive_out / name)
        print(f"\nAlso saved models.json and series.json to Google Drive: {drive_out}")

# %% [markdown]
# ## 8. Quick look (sanity check before using the site)

# %%
if __name__ == "__main__":
    import matplotlib.pyplot as plt

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))
    for r in records:
        ys = np.array(series[r["id"]]["ssp245"]["global"], dtype=float)
        ax1.plot(YEARS, ys, lw=0.8, alpha=0.7)
        if r["warming_2081_2100"].get("ssp245") is not None:
            ax2.scatter(r["tcr"], r["warming_2081_2100"]["ssp245"], s=20)
    ax1.set(title="Global warming, historical + SSP2-4.5", xlabel="Year", ylabel="°C vs 1850-1900")
    ax2.axvspan(1.4, 2.2, color="0.9")
    ax2.set(title="TCR vs 2081-2100 warming (SSP2-4.5)", xlabel="TCR (°C)", ylabel="°C vs 1850-1900")
    fig.tight_layout()
    fig.savefig(CACHE_DIR / "quicklook.png", dpi=120)
    plt.show()

# %%
if __name__ == "__main__" and IN_COLAB:
    import shutil
    from google.colab import files

    shutil.make_archive("project3_data", "zip", OUT_DIR)
    files.download("project3_data.zip")
