# Antibody Research

An interactive research report covering antibody sequence numbering and multi-reference canine CD20 antibody design.

**[Open the research report](https://zhichao-chang.github.io/antibody-research/)** · **[Teaching notes](https://zhichao-chang.github.io/antibody-research/teaching.html)** · **[6VJA structural viewer](https://zhichao-chang.github.io/antibody-research/6vja/index.html)**

## What is included

- A Chinese-language scientific report with model introductions, explicit comparison definitions, plots, and inspectable source data.
- Browser-based 3D inspection of seven human CD20 reference complexes, canine CD20, parent controls, and selected computational candidates.
- Separate diagnostics of receptor deformation, Fv/CDR geometry, relative pose, alignment-frame sensitivity, and contact footprints.
- Teaching notes and a dedicated 6VJA viewer with public coordinate files, PyMOL commands, session, and image.

The report retains 140 designed VH/VL pairs, a fixed 70-candidate review set, and 966 canonical structure predictions. These are computational research outputs; canine binding, affinity, and biological function have not been established experimentally.

## Hosting

This repository contains the verified static presentation. `index.html` embeds the reviewed data, molecular coordinates, and display code. Viewing does not require Python, PyMOL, model weights, a GPU compute server, or a connection to the author's computer. Use a modern browser with WebGL and `DecompressionStream` support.

GitHub Pages publishes the `main` branch from the repository root. `.nojekyll` keeps the supplied static files intact. All supporting files must remain at their relative paths. The initial report download is approximately 42 MB because the full scientific snapshot is included.

For local viewing:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000/`. This command is only a local preview; the published GitHub Pages site is hosted independently.

## Contents

```text
index.html              Self-contained research presentation
teaching.html           Teaching notes
6vja/                   Experimental reference viewer and downloadable assets
publication-manifest.json
```

## Data and software attribution

Source references, versions, comparison populations, formulas, and limitations are retained inside the report. Public structures originate from RCSB PDB; the dog starting monomer originates from AlphaFold DB. The embedded 3Dmol.js license is included in the report and viewers. Original research materials and third-party software/data retain their applicable rights; public hosting does not relicense them.

The independent numbering program is maintained separately at [antibody-numbering](https://github.com/ZhiChao-Chang/antibody-numbering).
