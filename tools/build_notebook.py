#!/usr/bin/env python3
"""Turn pipeline/cmip6_pipeline.py (percent-format cells) into pipeline/cmip6_pipeline.ipynb.

The .py file is the single source of truth: edit it, then run `python tools/build_notebook.py`.
"""
from pathlib import Path

import nbformat

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "pipeline" / "cmip6_pipeline.py"
DST = ROOT / "pipeline" / "cmip6_pipeline.ipynb"


def cells_from_percent(text):
    cells, kind, lines = [], None, []

    def flush():
        body = "\n".join(lines).strip("\n")
        if kind == "markdown":
            body = "\n".join(l[2:] if l.startswith("# ") else l.lstrip("#") for l in body.splitlines())
            cells.append(nbformat.v4.new_markdown_cell(body))
        elif kind == "code" and body.strip():
            cells.append(nbformat.v4.new_code_cell(body))

    for line in text.splitlines():
        if line.startswith("# %%"):
            flush()
            kind, lines = ("markdown" if "[markdown]" in line else "code"), []
        else:
            lines.append(line)
    flush()
    return cells


def main():
    nb = nbformat.v4.new_notebook()
    nb.cells = cells_from_percent(SRC.read_text())
    nb.metadata = {
        "kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"},
        "language_info": {"name": "python"},
        "colab": {"provenance": []},
    }
    nbformat.validate(nb)
    nbformat.write(nb, DST)
    for cell in nb.cells:
        if cell.cell_type == "code":
            compile(cell.source, "<cell>", "exec")
    print(f"Wrote {DST.relative_to(ROOT)} ({len(nb.cells)} cells, all code cells compile)")


if __name__ == "__main__":
    main()
