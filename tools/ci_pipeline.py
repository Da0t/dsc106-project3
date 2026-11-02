"""Run pipeline/cmip6_pipeline.py in parallel pieces (used on GitHub Actions to build data/).

    python tools/ci_pipeline.py plan                 # read the catalog, open one store, save plan.json
    python tools/ci_pipeline.py shard K N            # process every N-th model starting at K into cache/
    python tools/ci_pipeline.py merge OUT_DIR        # combine the cached models into OUT_DIR/*.json

Each model is cached as cache/<model>.json, exactly as in the notebook, so merging only reads files.
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("cmip6_pipeline", ROOT / "pipeline" / "cmip6_pipeline.py")
P = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P)

PLAN = Path("plan.json")


def plan():
    runs = P.select_runs(P.load_catalog())
    print(P.show_plan(runs).to_string(index=False))
    P.smoke_test(runs)
    PLAN.write_text(json.dumps(runs))


def shard(k, n):
    runs = json.loads(PLAN.read_text())
    P.ONLY_MODELS = [m for i, m in enumerate(sorted(runs)) if i % n == k]
    print(f"Shard {k} of {n}: {', '.join(P.ONLY_MODELS) or 'no models'}")
    if not P.ONLY_MODELS:
        P.CACHE_DIR.mkdir(parents=True, exist_ok=True)
        return
    _, _, failures = P.run_all(runs)
    (P.CACHE_DIR / f"failures-{k}.txt").write_text(json.dumps(failures))


def merge(out_dir):
    runs = json.loads(PLAN.read_text())
    cached = sorted(p.stem for p in P.CACHE_DIR.glob("*.json") if p.stem in runs)
    failures = {}
    for f in P.CACHE_DIR.glob("failures-*.txt"):
        failures.update(json.loads(f.read_text()))
    failures.update({m: "not processed" for m in runs if m not in cached and m not in failures})
    if not cached:
        sys.exit("No models finished; not publishing.")
    P.ONLY_MODELS = cached
    records, series, _ = P.run_all(runs)
    P.export(records, series, failures, out_dir=out_dir, demo=False)
    P.story_check(records, series)
    if len(records) < 10:
        sys.exit(f"Only {len(records)} models finished; not publishing.")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "plan":
        plan()
    elif cmd == "shard":
        shard(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == "merge":
        merge(sys.argv[2])
    else:
        sys.exit(__doc__)
