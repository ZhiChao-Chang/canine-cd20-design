# Project results page

This is the editable, read-only frontend for the canine CD20 project. It uses React, Recharts, Markdown, and the existing 3Dmol molecular scenes. Project-specific content lives in `src/content/report/`; `src/project-ui.jsx` supplies local chart/table/data components. It does not require the original authoring environment.

```bash
npm ci
npm run dev
```

From the repository root, `python3 scripts/build_site.py` builds a portable single HTML page at `index.html` while keeping `teaching.html` and `6vja/` in their existing locations. GitHub Pages continues to serve the repository root.

The source snapshot is `src/data.json`. `scripts/build_site.py` refreshes its query rows from `data/results/display_queries/` before building, so figures use checked-in research data. Three-dimensional scenes and sequence comparisons are in `src/content/assets/`. Larger model calculations run through the Python workflow, separately from page viewing.

When changing scientific inputs or analysis, update the appropriate research outputs first, then the display-query data. The application keeps the seven reference groups, parent-based masks, selected set, model pairing, and repeatability scope explicit.

The molecular viewer notice is in `3Dmol-LICENSE.txt`; npm dependencies retain their individual licenses.
