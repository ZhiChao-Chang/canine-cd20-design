# Project data

`inputs/` holds the canine CD20 sequences, seven human reference parent pairs, fixed-length design contracts, frozen IMGT masks, and RFD4/BoltzGen conditions. The original experimental references are PDB 6VJA, 6Y90, 6Y92, 6Y97, 6Y9A, 8VGN, and 8VGO. Starting dog monomer geometry comes from AlphaFold DB Q3C2E2 v6. The original experimental mmCIFs and dog monomer are included in compressed form; `rebuild-inputs` reproduces their transferred starting assemblies while preserving the frozen parent masks.

`designs/` contains 140 normalized four-chain design structures; `predictions/` contains 966 native model structures and their confidence JSON. Files are gzip-compressed with original uncompressed SHA-256 identities in the indexes. `cd20-design prepare --with-predictions --with-designs` restores their workspace paths.

`coordinates/predictions.npz` stores float64 C-alpha coordinates for all 966 predictions, indexed by `coordinates/index.json`. This compact view reproduces pose and seed comparisons; the native all-atom files support contacts and clash measurements.

`results/` includes the completed experiment's candidate ranking, per-prediction metrics, model-pair comparisons, parent controls, paired FASTA, and repeatability tables. Machine-specific file locations have been replaced by project-relative workspace paths; scientific values and identifiers are preserved. `results/display_queries/` contains the extended diagnostic rows shown on the page.

The primary screen contains 462 predictions. The repeatability table has 756 rows, including 252 seed42 rows already in the screen; 462 + 756 - 252 = 966 unique predictions. Repeated predictions are not independent new antibody designs.

Input source identities and model versions remain with the contracts and configuration. Third-party reference data and model outputs retain applicable source terms; the code license does not relicense them.
