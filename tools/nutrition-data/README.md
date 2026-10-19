# nutai-nutrition-data

Builds the `nutrition.db` artifact the app bundles.

**This project and its output are licensed separately from the application.**
The app is AGPL-3.0; this pipeline is ODbL-1.0, because that is the license the
Open Food Facts tier imports once it is added. Data licenses and code licenses
are legally independent — neither discharges the other.

Sources and their actual terms:

| Source | License | Obligation |
|---|---|---|
| USDA FoodData Central — Foundation Foods, SR Legacy | **CC0 1.0** | None legally. Attributed anyway. |
| USDA FoodData Central — Branded Foods | **CC0 1.0**, carries `gtin_upc` | Preferred over Open Food Facts for US barcodes, which keeps ODbL share-alike off the largest slice of the corpus. |
| Open Food Facts | **ODbL 1.0** + DbCL 1.0 + CC BY-SA 3.0 (photos) | Attribution + share-alike. The shipped `.sqlite` is itself a Derivative Database. |

## Open Food Facts, Poland (ingested)

`data/off-pl.csv` is a pre-filtered snapshot of Open Food Facts products tagged
`en:poland`, committed so CI builds are reproducible. `src/off.mjs` reads it.
This fork prefers Open Food Facts over USDA when a barcode appears in both
(the USDA tier here carries no barcodes at all, so no collision exists today).

Regenerate with `scripts/off_export.py` (needs `pip install duckdb` and a local
`food.parquet` from the OFF Hugging Face dataset; it makes no network calls):

    python3 scripts/off_export.py food.parquet   # writes off_pl.csv and off_report.txt
    cp off_pl.csv data/off-pl.csv

`SKIP_OFF=1 npm run data:build` builds the USDA tier only; `OFF_CSV=path`
overrides the snapshot location. The artifact's manifest records the OFF
attribution; if this repo or the built database is ever distributed, ODbL
attribution and share-alike apply (see table above).

Not yet ingested, all verified genuinely open and bulk-downloadable:
UK CoFID (OGL v3.0) · Japan MEXT (numerical data explicitly not copyrightable) ·
France CIQUAL (Licence Ouverte) · Germany BLS 4.0 (CC BY 4.0 — free only since
Dec 2025) · Australia FSANZ (CC BY 4.0 AU, and its AUSNUT carries 16,152 portion
records that feed the gram engine directly).

**Do not bundle**, verified restricted: China CFCT (all rights reserved),
India IFCT (restricted), Netherlands NEVO ("unchanged form" only),
Italy CREA, EuroFIR (paid membership).
