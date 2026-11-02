#!/usr/bin/env python3
"""Make clearly labeled DEMO data, and test the pipeline end to end.

This runs the real pipeline (pipeline/cmip6_pipeline.py) on synthetic, CMIP6-shaped inputs:
a fake catalog plus fake monthly temperature grids with mixed calendars, ensemble members,
grids, versions, control-run drift and branch metadata. A simple two-timescale energy-balance
response turns forcing into warming, so each fake model has a known TCR to recover.

The numbers are NOT real climate-model output. The site shows a banner whenever
data/models.json has "demo": true, so by default nothing is written into data/.

    python tools/make_demo_data.py --test              # run the pipeline checks (data/ is not touched)
    python tools/make_demo_data.py --out some/folder   # keep the demo JSON files there
"""
import argparse
import importlib.util
import json
import tempfile
from functools import lru_cache
from pathlib import Path

import cftime
import numpy as np
import pandas as pd
import xarray as xr

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("cmip6_pipeline", ROOT / "pipeline" / "cmip6_pipeline.py")
P = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P)

F2X = 3.9                      # W m-2 from doubled CO2
LAT = np.arange(-85.0, 90.0, 10.0)
LON = np.arange(5.0, 360.0, 10.0)
LAT2, LON2 = np.meshgrid(LAT, LON, indexing="ij")
W = np.cos(np.deg2rad(LAT2))
BASE = 300.0 - 45.0 * np.sin(np.deg2rad(LAT2)) ** 2
SEASON = 2.0 + 18.0 * np.abs(np.sin(np.deg2rad(LAT2)))
SIGMA_LOCAL = 0.25 + 0.9 * (np.abs(LAT2) / 90.0) ** 2
SCENARIOS = ["ssp126", "ssp245", "ssp585"]
CALENDARS = ["noleap", "360_day", "proleptic_gregorian", "standard"]
TCRS = [2.95, 2.83, 2.74, 2.66, 2.56, 2.45, 2.33, 2.24, 2.15, 2.08, 2.02,
        1.96, 1.90, 1.84, 1.79, 1.74, 1.68, 1.63, 1.57, 1.52, 1.45, 1.32]


def model_specs():
    rng = np.random.default_rng(106)
    specs = {}
    for i, tcr in enumerate(TCRS):
        sid = f"DEMO-{i + 1:02d}"
        specs[sid] = dict(
            id=sid, tcr=tcr,
            arctic=rng.uniform(1.4, 3.4),     # Arctic amplification, independent of TCR
            tropics=rng.uniform(0.78, 0.95),
            socal=rng.uniform(0.15, 0.55),
            slow=rng.uniform(0.7, 1.3),       # weight of the slow deep-ocean response
            calendar=CALENDARS[i % 4],
            pi_start=[1, 1850, 2400, 1][i % 4],
            pct_start=[1850, 1, 1850, 1850][i % 4],
            branch_offset=int(rng.integers(0, 120)),
            drift=float(rng.normal(0, 0.06)),  # K per century in the control run
            hist_member="r1i1p1f2" if i % 5 == 1 else "r1i1p1f1",
            has_ssp126=(i != 7),
            branch_attrs=(i != 4),            # one model has no branch metadata (fallback path)
            seed=1000 + i,
        )
    return specs


SPECS = model_specs()


def forcing_hist(years):
    x = np.clip((years - 1850) / (2014 - 1850), 0, None)
    f = 2.2 * x ** 2.6
    for year, amp in [(1883, -1.6), (1902, -0.7), (1963, -1.1), (1982, -1.0), (1991, -1.9)]:
        dt = years - year
        f = f + np.where(dt >= 0, amp * np.exp(-np.clip(dt, 0, None) / 1.2), 0.0)
    return f


def forcing_ssp(years, scen):
    x = (years - 2014) / 86.0
    f0 = 2.2
    if scen == "ssp126":
        return f0 + 3.4 * x * np.exp(-2.5 * x) + 0.1 * x
    if scen == "ssp245":
        return f0 + 2.2 * (1 - np.exp(-1.4 * x)) / (1 - np.exp(-1.4))
    return f0 + 6.3 * x ** 1.3


def response(forcing, q_fast, q_slow, d_fast=4.0, d_slow=180.0):
    t_fast = t_slow = 0.0
    out = np.empty(len(forcing))
    for i, f in enumerate(forcing):
        t_fast += (q_fast * f - t_fast) / d_fast
        t_slow += (q_slow * f - t_slow) / d_slow
        out[i] = t_fast + t_slow
    return out


def calibrate(spec):
    ramp = F2X * np.arange(1, 151) / 70.0
    unit = response(ramp, 1.0, spec["slow"])
    scale = spec["tcr"] / unit[60:80].mean()
    return scale, scale * spec["slow"]


def ar1(rng, n, phi, shape=(), start=None):
    """Unit-variance AR(1) noise."""
    eps = rng.normal(0.0, np.sqrt(1 - phi ** 2), size=(n, *shape))
    out = np.empty_like(eps)
    prev = np.zeros(shape) if start is None else start
    for i in range(n):
        prev = phi * prev + eps[i]
        out[i] = prev
    return out


def pattern(spec):
    p = spec["tropics"] + spec["arctic"] * np.clip((LAT2 - 45) / 45, 0, 1) ** 2
    p = p + 0.4 * np.clip((-LAT2 - 50) / 40, 0, 1)
    p = p + spec["socal"] * np.exp(-(((LAT2 - 33) / 6) ** 2) - (((LON2 - 241) / 9) ** 2))
    return p / ((p * W).sum() / W.sum())


@lru_cache(maxsize=None)
def simulate(sid):
    spec = SPECS[sid]
    rng = np.random.default_rng(spec["seed"])
    qf, qs = calibrate(spec)
    pat = pattern(spec)

    def fields(signal, g_noise, l_noise):
        return (BASE[None] + signal[:, None, None] * pat[None]
                + 0.11 * g_noise[:, None, None] + SIGMA_LOCAL[None] * l_noise)

    runs = {}
    n_pi = 300
    drift = spec["drift"] / 100.0
    runs["piControl"] = (fields(drift * np.arange(n_pi), ar1(rng, n_pi, 0.55), ar1(rng, n_pi, 0.3, LAT2.shape)),
                         spec["pi_start"])
    k = np.arange(150)
    pct = response(F2X * (k + 1) / 70.0, qf, qs) + drift * (spec["branch_offset"] + k)
    runs["1pctCO2"] = (fields(pct, ar1(rng, 150, 0.55), ar1(rng, 150, 0.3, LAT2.shape)), spec["pct_start"])

    hist_years, fut_years = np.arange(1850, 2015), np.arange(2015, 2101)
    hist_g, hist_l = ar1(rng, len(hist_years), 0.55), ar1(rng, len(hist_years), 0.3, LAT2.shape)
    for j, scen in enumerate(SCENARIOS):
        warming = response(np.concatenate([forcing_hist(hist_years), forcing_ssp(fut_years, scen)]), qf, qs)
        if j == 0:
            runs["historical"] = (fields(warming[:len(hist_years)], hist_g, hist_l), 1850)
        srng = np.random.default_rng([spec["seed"], j])
        fut_g = ar1(srng, len(fut_years), 0.55, start=hist_g[-1])
        fut_l = ar1(srng, len(fut_years), 0.3, LAT2.shape, start=hist_l[-1])
        runs[scen] = (fields(warming[len(hist_years):], fut_g, fut_l), 2015)
    return runs


def time_axis(first_year, n_years, calendar):
    years = np.repeat(np.arange(first_year, first_year + n_years), 12)
    months = np.tile(np.arange(1, 13), n_years)
    if calendar in ("standard", "proleptic_gregorian") and first_year >= 1700 and first_year + n_years < 2262:
        return pd.DatetimeIndex(pd.to_datetime({"year": years, "month": months, "day": 15}))
    return xr.CFTimeIndex([cftime.datetime(int(y), int(m), 15, calendar=calendar) for y, m in zip(years, months)])


def make_dataset(annual_fields, first_year, calendar, attrs):
    n_years = annual_fields.shape[0]
    cycle = np.cos(2 * np.pi * (np.arange(12) - 6) / 12)
    seasonal = (SEASON * np.sign(LAT2))[None] * cycle[:, None, None]
    data = (annual_fields[:, None] + seasonal[None]).reshape(n_years * 12, len(LAT), len(LON)).astype("float32")
    ds = xr.Dataset({"tas": (("time", "lat", "lon"), data)},
                    coords={"time": time_axis(first_year, n_years, calendar), "lat": LAT, "lon": LON, "height": 2.0})
    ds["time"].encoding["calendar"] = calendar
    ds.attrs.update(attrs)
    return ds


def fake_open_store(zstore):
    _, _, _, sid, exp, member, grid, version = zstore.split("/")
    spec = SPECS[sid]
    fields, first_year = simulate(sid)[exp]
    attrs = {"source_id": sid, "experiment_id": exp}
    if exp == "1pctCO2" and spec["branch_attrs"]:
        branch = cftime.datetime(spec["pi_start"] + spec["branch_offset"], 1, 1, calendar=spec["calendar"])
        attrs.update(parent_experiment_id="piControl", parent_time_units="days since 0001-01-01",
                     branch_time_in_parent=float(cftime.date2num(branch, "days since 0001-01-01",
                                                                 calendar=spec["calendar"])))
    return make_dataset(fields, first_year, spec["calendar"], attrs)


def fake_catalog_csv(path):
    rows = []

    def add(sid, exp, member, grid="gn", version="20190101", variable="tas", table="Amon"):
        rows.append(dict(activity_id="CMIP", institution_id="SYNTHETIC", source_id=sid, experiment_id=exp,
                         member_id=member, table_id=table, variable_id=variable, grid_label=grid,
                         zstore=f"gs://demo/{sid}/{exp}/{member}/{grid}/v{version}", dcpp_init_year="",
                         version=version))

    for sid, s in SPECS.items():
        add(sid, "piControl", "r1i1p1f1", grid="gr" if sid == "DEMO-03" else "gn")
        add(sid, "1pctCO2", "r1i1p1f1")
        for exp in ["historical", "ssp245", "ssp585"] + (["ssp126"] if s["has_ssp126"] else []):
            add(sid, exp, s["hist_member"])
        add(sid, "historical", "r2i1p1f1")                         # member without ssp585: not chosen
        add(sid, "ssp245", "r2i1p1f1")
        add(sid, "historical", s["hist_member"], version="20180101")             # older version
        add(sid, "historical", s["hist_member"], grid="gr", version="20200101")  # non-native grid
        add(sid, "historical", s["hist_member"], variable="pr")                  # other variable
        add(sid, "historical", s["hist_member"], table="day")                    # other table
    for exp in ["piControl", "1pctCO2", "historical", "ssp245"]:                 # no ssp585: excluded
        add("DEMO-NO585", exp, "r1i1p1f1")
    pd.DataFrame(rows).to_csv(path, index=False)


def run(out_dir, cache_dir):
    P.open_store = fake_open_store
    P.CACHE_DIR = Path(cache_dir)
    P.REFRESH_CACHE = True
    with tempfile.TemporaryDirectory() as tmp:
        csv = Path(tmp) / "catalog.csv"
        fake_catalog_csv(csv)
        plan = P.select_runs(P.load_catalog(csv))
    records, series, failures = P.run_all(plan)
    P.export(records, series, failures, out_dir=out_dir, demo=True)
    return plan, records, series, failures


def check(plan, records, series, failures, out_dir):
    assert "DEMO-NO585" not in plan, "model without ssp585 should be excluded"
    assert len(plan) == len(SPECS), f"expected {len(SPECS)} models, got {len(plan)}"
    assert not failures, failures
    assert plan["DEMO-02"]["runs"]["historical"]["member"] == "r1i1p1f2", "f2 member should be kept"
    assert "ssp126" not in plan["DEMO-08"]["runs"], "optional scenario should be skipped when absent"
    hist = plan["DEMO-01"]["runs"]["historical"]
    assert (hist["grid"], hist["version"]) == ("gn", "20190101"), hist
    assert plan["DEMO-03"]["runs"]["piControl"]["grid"] == "gr"

    # TCR comes from one 20-year window, so internal variability adds about ±0.05 °C (1 sigma).
    # Check for bias and for errors far beyond that noise, not for perfect recovery.
    errors = np.array([r["tcr"] - SPECS[r["id"]]["tcr"] for r in records])
    worst = float(np.abs(errors).max())
    assert abs(errors.mean()) < 0.04, f"TCR biased by {errors.mean():+.3f} °C"
    assert np.abs(errors).mean() < 0.08, f"mean TCR error {np.abs(errors).mean():.3f} °C"
    assert worst < 0.25, f"worst TCR error {worst:.3f} °C"
    for r in records:
        for scen, cross in r["crossing"].items():
            ys = [cross[k] for k in ("1.5", "2", "3", "4") if cross[k] is not None]
            assert ys == sorted(ys), (r["id"], scen, cross)
    assert any(not r["tcr_method"].startswith("branch") for r in records), "fallback path untested"

    blob = json.loads((Path(out_dir) / "series.json").read_text())
    assert len(blob["years"]) == 251
    for sid, scens in blob["series"].items():
        for scen, curves in scens.items():
            for key, values in curves.items():
                assert len(values) == 251, (sid, scen, key)
    meta = json.loads((Path(out_dir) / "models.json").read_text())["meta"]
    assert meta["demo"] is True
    print(f"\nAll pipeline checks passed. TCR recovery: mean error {errors.mean():+.3f} °C, "
          f"mean |error| {np.abs(errors).mean():.3f} °C, worst {worst:.3f} °C")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="folder for the demo JSON files (default: a temporary folder; data/ is never touched)")
    ap.add_argument("--test", action="store_true")
    args = ap.parse_args()
    with tempfile.TemporaryDirectory() as cache, tempfile.TemporaryDirectory() as scratch:
        out = args.out or scratch
        plan, records, series, failures = run(out, cache)
        P.story_check(records, series)
        if args.test:
            check(plan, records, series, failures, out)
