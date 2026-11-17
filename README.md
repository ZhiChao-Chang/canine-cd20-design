<h1 align="center">Canine CD20 Design</h1>

<p align="center">
  <strong>Reference-conditioned antibody design and structural analysis.</strong><br>
  Experiment inputs, model interfaces, candidate structures, analysis code, and an interactive results page.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#research-workflow">Workflow</a> ·
  <a href="#project-data">Data</a> ·
  <a href="https://zhichao-chang.github.io/canine-cd20-design/">Explore results ↗</a>
</p>

---

This project investigates CDR redesign against **canine CD20 (UniProt Q3C2E2)**, starting separately from seven human CD20–antibody reference complexes. Two generation routes produce paired VH/VL candidates; three structure predictors assess the resulting complexes. The source, frozen study inputs, native outputs, and analysis are maintained here. The [results page](https://zhichao-chang.github.io/canine-cd20-design/) is one project output.

<table align="center"><thead><tr><th align="center">References</th><th align="center">Generation routes</th><th align="center">VH/VL candidates</th><th align="center">Predictions</th></tr></thead><tbody><tr><td align="center"><strong>7</strong></td><td align="center"><strong>2</strong></td><td align="center"><strong>140</strong></td><td align="center"><strong>966</strong></td></tr></tbody></table>

## Quick start

Python 3.10+ is used for preparation and structural analysis. Run from the checkout:

```bash
git clone https://github.com/ZhiChao-Chang/canine-cd20-design.git
cd canine-cd20-design
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
cd20-design reproduce --output work/reproduced
cd20-design reproduce-diagnostics --output work/diagnostics
```

The first command recomputes 420 primary model-pair comparisons, the ranking of all 140 candidates, the retained set of 70, and cross-seed pose statistics from the included C-alpha coordinates. It writes CSV, paired FASTA, and a summary into a new directory. The diagnostics command additionally reconstructs the target/Fv/CDR comparisons, design-pose checks, and experimental contact footprints used in the figures. Model weights and GPU inference are separate from this analysis.

For an all-atom example:

```bash
cd20-design inspect-structure \
  --structure examples/structure_comparison/alphafold3.cif.gz \
  --reference 6VJA \
  --model alphafold3 \
  --confidence examples/structure_comparison/alphafold3.confidence.json \
  --output work/example_metrics.json
```

## Research workflow

1. **Prepare reference-specific inputs.** Each reference keeps its own paired VH/VL, initial assembly, and frozen parent-based IMGT masks. Canine CD20 residues 46–210 provide the 165-residue target core; extracellular contact evaluation uses positions 73–75 and 144–188.
2. **Generate CDR variants.** RFD4–Proteina proposes sequence/structure designs. BoltzGen performs structural design and inverse folding, with SolubleMPNN inside that route. Each reference/route has ten attempts: one at seed101 and nine at seed102.
3. **Re-predict final sequences.** AF3, Boltz-2, and ESMFold2 standard receive the A/B target dimer and paired H/L sequences, empty MSAs, and no templates. Seed42 covers 140 designs and 14 parent controls.
4. **Select and compare.** Selection uses extracellular CDR-contact support, within-reference/model confidence percentiles, cross-model Fv pose, and CDR diversity. Five candidates per route/reference are retained. Clashes remain diagnostic outputs.
5. **Check repeatability.** The fixed retained candidates and parent controls receive seeds43/44. Geometry, contacts, and model differences are analyzed in the same reference-specific groups.

Settings are in [configs/study.json](configs/study.json), [configs/ranking.json](configs/ranking.json), and [configs/models.json](configs/models.json). The project studies computational candidates; experimental binding and function remain research follow-up.

Starting assemblies can also be rebuilt from the included experimental structures and dog monomer, using the frozen parent maps:

```bash
cd20-design rebuild-inputs --output work/rebuilt_inputs
```

## Prepare or replay a workspace

```bash
cd20-design prepare --output work/replay --with-predictions --with-designs
cd20-design analyze-workspace --workspace work/replay --stage primary
cd20-design analyze-workspace --workspace work/replay --stage robustness
```

`--with-predictions` expands the bundled native structures and confidence JSON; `--with-designs` expands generated conformations. Omit these flags when preparing a fresh calculation; only parent controls are prepared until new designs are collected. Add `--reference 6VJA` for a single-reference workspace.

For new generation, install the matching model environments separately and copy [configs/tools.example.json](configs/tools.example.json) to the ignored `configs/tools.local.json` with your paths:

```bash
cd20-design prepare --output work/new_study
cd20-design plan --workspace work/new_study --tools configs/tools.local.json --stage generation
# Add --execute to run the listed model commands.
cd20-design collect-designs --workspace work/new_study
cd20-design plan --workspace work/new_study --tools configs/tools.local.json --stage primary
cd20-design analyze-workspace --workspace work/new_study --stage primary
cd20-design prepare-followup --workspace work/new_study
cd20-design plan --workspace work/new_study --tools configs/tools.local.json --stage followup
cd20-design analyze-workspace --workspace work/new_study --stage robustness
```

Model plans print by default; each generation/prediction plan needs `--execute` to run. Model versions and original invocation roles are recorded in `configs/models.json`. The command adapters mirror this study's tool interfaces.

## Project data

- **Inputs:** target sequences, seven parent pairs, fixed masks, initial complexes, and generator conditions.
- **Designs:** all 140 normalized generated complexes.
- **Predictions:** all 966 native structures with confidence JSON, compressed individually.
- **Analysis:** candidate/parent metrics, model-pair comparisons, selection, paired FASTA, and repeatability tables.
- **Display:** coordinate/sequence views and extended diagnostic rows used by the results page.

See [data/README.md](data/README.md). Frozen masks reproduce this completed study; updating the companion [numbering tool](https://github.com/ZhiChao-Chang/antibody-numbering) does not silently change old designs.

## Results website

Browse [the project results](https://zhichao-chang.github.io/canine-cd20-design/), [teaching notes](https://zhichao-chang.github.io/canine-cd20-design/teaching.html), or the [6VJA viewer](https://zhichao-chang.github.io/canine-cd20-design/6vja/index.html).

The read-only React source is in `web/`, using the same frozen project dataset and molecular-viewer assets. Build it with Node22.12+:

```bash
npm --prefix web ci
python3 scripts/build_site.py
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/`. The generated `index.html` stays at the existing Pages entry point. Molecular rotation and filtering display existing results. See [web/README.md](web/README.md) for editing the content and dataset.

## Layout

```text
configs/              Study settings, selection policy, model paths
src/canine_cd20/      Preparation, model plans, metrics, and analysis
scripts/              Model-output checks, model adapter, site builder
data/                 Frozen inputs, generated/predicted structures, result tables
examples/             Complete three-model structure-analysis example
tests/                Numerical, constraint, preparation, and study regressions
web/                  Editable React results-page source
index.html            Generated project-results page
teaching.html, 6vja/   Companion visualizations
```

## Development and sources

```bash
python3 -m unittest discover -s tests -v
```

Original project code is [MIT licensed](LICENSE). Public structures, reference materials, model outputs, and dependencies retain their applicable source terms. The molecular viewer's notice is included in [web/3Dmol-LICENSE.txt](web/3Dmol-LICENSE.txt).
