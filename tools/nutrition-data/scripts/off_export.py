#!/usr/bin/env python3
"""
Etap 2, krok 2: eksport produktow z Polski z lokalnego food.parquet do CSV.
Nic nie zmienia w repo. Zadnych zapytan sieciowych (stad brak limitu 429).

Uruchomienie (PowerShell lub WSL), plik food.parquet pobrany wczesniej:
  python3 off_export.py food.parquet

Wynik:
  off_pl.csv          produkty po filtrach jakosci (UTF-8)
  off_report.txt      lejek filtrow, statystyki, losowe wiersze do oceny na oko
Wyslij mi off_report.txt (i off_pl.csv, jesli rozsadnego rozmiaru).

Nazwy skladnikow w `nutriments` (energy-kcal, proteins, fat, carbohydrates,
fiber, sugars, sodium, salt) sa z mojej wiedzy o OFF, nie z probki (probka byla
pusta). Raport wypisuje najczesstsze nazwy skladnikow w danych z Polski,
zeby to zweryfikowac.
"""
import sys

import duckdb

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SRC = sys.argv[1] if len(sys.argv) > 1 else "food.parquet"
OUT_CSV = "off_pl.csv"
OUT_REPORT = "off_report.txt"

report = []


def say(line=""):
    print(line, flush=True)
    report.append(line)


def nut(name):
    """Wartosc na 100 g dla skladnika o danej nazwie (NULL gdy brak)."""
    return (
        f"struct_extract((list_filter(nutriments, x -> x.name = '{name}'))[1], '100g')"
    )


con = duckdb.connect()
src = SRC.replace("'", "''")

con.execute(
    f"""
CREATE TEMP TABLE pl AS
SELECT
  code,
  struct_extract((list_filter(product_name, x -> x.lang = 'pl'))[1], 'text') AS name_pl,
  struct_extract((list_filter(product_name, x -> x.lang = 'main'))[1], 'text') AS name_main,
  lang AS row_lang,
  trim(split_part(brands, ',', 1)) AS brand,
  categories_tags[len(categories_tags)] AS category,
  {nut('energy-kcal')} AS kcal_direct,
  {nut('energy-kj')} AS kj,
  {nut('proteins')} AS protein_g,
  {nut('fat')} AS fat_g,
  {nut('saturated-fat')} AS sat_fat_g,
  {nut('carbohydrates')} AS carb_g,
  {nut('fiber')} AS fiber_g,
  {nut('sugars')} AS sugar_g,
  {nut('sodium')} AS sodium_g,
  {nut('salt')} AS salt_g,
  {nut('alcohol')} AS alcohol_raw,
  struct_extract((list_filter(nutriments, x -> x.name = 'alcohol'))[1], 'unit') AS alcohol_unit,
  nutrition_data_per,
  try_cast(serving_quantity AS DOUBLE) AS serving_g,
  serving_size AS serving_desc,
  try_cast(product_quantity AS DOUBLE) AS package_g,
  coalesce(unique_scans_n, 0) AS unique_scans_n,
  completeness,
  last_modified_t
FROM read_parquet('{src}')
WHERE list_contains(countries_tags, 'en:poland')
  AND coalesce(obsolete, false) = false
"""
)

con.execute(
    """
CREATE TEMP TABLE pl2 AS
SELECT *,
  coalesce(kcal_direct, kj / 4.184) AS kcal,
  coalesce(sodium_g * 1000, salt_g / 2.5 * 1000) AS sodium_mg,
  coalesce(name_pl, name_main) AS name,
  CASE WHEN name_pl IS NOT NULL THEN 'pl'
       WHEN name_main IS NOT NULL THEN coalesce(row_lang, '?') END AS name_lang,
  -- OFF podaje alkohol zwykle w % vol (1 % vol = ok. 0.789 g etanolu na 100 ml), czasem w g
  CASE WHEN alcohol_raw IS NULL THEN 0
       WHEN alcohol_unit = 'g' THEN alcohol_raw
       ELSE alcohol_raw * 0.789 END AS alcohol_g,
  4 * protein_g + 4 * carb_g + 9 * fat_g
    + 7 * (CASE WHEN alcohol_raw IS NULL THEN 0
                WHEN alcohol_unit = 'g' THEN alcohol_raw
                ELSE alcohol_raw * 0.789 END) AS atwater_kcal
FROM pl
"""
)

steps = [
    ("produkty z Polski (bez obsolete)", "TRUE"),
    ("ma nazwe (pl, a w razie braku glowna dowolnego jezyka)", "name IS NOT NULL AND length(trim(name)) >= 2"),
    ("kod to 8-14 cyfr", "regexp_matches(code, '^[0-9]{8,14}$')"),
    (
        "ma kcal, bialko, tluszcz, weglowodany",
        "kcal IS NOT NULL AND protein_g IS NOT NULL AND fat_g IS NOT NULL AND carb_g IS NOT NULL",
    ),
    (
        "wartosci w sensownych zakresach",
        "kcal BETWEEN 0 AND 900 AND protein_g BETWEEN 0 AND 100 AND fat_g BETWEEN 0 AND 100 "
        "AND carb_g BETWEEN 0 AND 100 AND protein_g + fat_g + carb_g <= 105 "
        "AND coalesce(sugar_g, 0) BETWEEN 0 AND 100 AND coalesce(fiber_g, 0) BETWEEN 0 AND 100",
    ),
    (
        "kcal zgodne z makro (0.6x do 1.4x wzoru Atwatera z alkoholem, gdy wzor >= 20)",
        "(atwater_kcal < 20 OR kcal BETWEEN 0.6 * atwater_kcal AND 1.4 * atwater_kcal)",
    ),
]

say("LEJEK FILTROW")
where = []
prev = None
for label, cond in steps:
    where.append(f"({cond})")
    n = con.execute(f"SELECT count(*) FROM pl2 WHERE {' AND '.join(where)}").fetchone()[0]
    drop = "" if prev is None else f"  (odpadlo {prev - n})"
    say(f"  {n:>8}  {label}{drop}")
    prev = n

final_where = " AND ".join(where)

con.execute(
    f"""
CREATE TEMP TABLE final AS
SELECT
  code,
  trim(name) AS name,
  name_lang,
  nullif(brand, '') AS brand,
  category,
  round(CAST(kcal AS DOUBLE), 1) AS energy_kcal,
  round(CAST(protein_g AS DOUBLE), 2) AS protein_g,
  round(CAST(fat_g AS DOUBLE), 2) AS fat_g,
  round(CAST(sat_fat_g AS DOUBLE), 2) AS sat_fat_g,
  round(CAST(carb_g AS DOUBLE), 2) AS carb_g,
  round(CAST(fiber_g AS DOUBLE), 2) AS fiber_g,
  round(CAST(sugar_g AS DOUBLE), 2) AS sugar_g,
  round(CAST(sodium_mg AS DOUBLE), 0) AS sodium_mg,
  nutrition_data_per,
  CASE WHEN nutrition_data_per = 'serving' THEN 'medium' ELSE 'high' END AS basis_confidence,
  round(CAST(alcohol_g AS DOUBLE), 2) AS alcohol_g,
  serving_g AS serving_size_g,
  serving_desc,
  package_g,
  unique_scans_n,
  completeness,
  last_modified_t AS updated_at
FROM pl2
WHERE {final_where}
QUALIFY row_number() OVER (PARTITION BY code ORDER BY completeness DESC NULLS LAST, last_modified_t DESC NULLS LAST) = 1
"""
)

total = con.execute("SELECT count(*) FROM final").fetchone()[0]
say(f"  {total:>8}  po deduplikacji po kodzie (wynik koncowy)")
con.execute(f"COPY final TO '{OUT_CSV}' (HEADER, DELIMITER ',', FORMAT CSV)")

say("")
say("POKRYCIE POL W WYNIKU (liczba wierszy z wartoscia)")
for col in ["brand", "category", "sat_fat_g", "fiber_g", "sugar_g", "sodium_mg", "serving_size_g", "package_g"]:
    n = con.execute(f"SELECT count({col}) FROM final").fetchone()[0]
    pct = 100 * n / total if total else 0
    say(f"  {col:<16} {n:>8}  ({pct:.0f}%)")

say("")
say("PODSTAWA ODNIESIENIA (nutrition_data_per)")
for val, n in con.execute(
    "SELECT nutrition_data_per, count(*) FROM final GROUP BY 1 ORDER BY 2 DESC"
).fetchall():
    say(f"  {str(val):<12} {n}")

say("")
say("JEZYK NAZWY W WYNIKU (pl = indeksowane do wyszukiwania po nazwie)")
for val, n in con.execute(
    "SELECT name_lang, count(*) FROM final GROUP BY 1 ORDER BY 2 DESC LIMIT 12"
).fetchall():
    say(f"  {str(val):<12} {n}")
n_alc = con.execute("SELECT count(*) FROM final WHERE alcohol_g > 0").fetchone()[0]
say(f"  produkty z alkoholem (alcohol_g > 0): {n_alc}")
for r in con.execute(
    "SELECT name, alcohol_g, energy_kcal FROM final WHERE alcohol_g > 0 USING SAMPLE 5 ROWS"
).fetchall():
    say("    " + " | ".join(str(v) for v in r))

say("")
say("NAJCZESTSZE NAZWY SKLADNIKOW W DANYCH Z POLSKI (weryfikacja nazw uzytych w skrypcie)")
for name, n in con.execute(
    f"""
    SELECT s.name, count(*) c
    FROM (SELECT unnest(nutriments) AS s FROM read_parquet('{src}')
          WHERE list_contains(countries_tags, 'en:poland'))
    GROUP BY 1 ORDER BY 2 DESC LIMIT 25
    """
).fetchall():
    say(f"  {name:<28} {n}")

say("")
say("LOSOWE WIERSZE (do oceny na oko)")
for r in con.execute(
    "SELECT code, name, name_lang, brand, energy_kcal, protein_g, fat_g, carb_g, serving_size_g "
    "FROM final USING SAMPLE 20 ROWS"
).fetchall():
    say("  " + " | ".join("" if v is None else str(v) for v in r))

with open(OUT_REPORT, "w", encoding="utf-8") as f:
    f.write("\n".join(report) + "\n")
print(f"\nGotowe: {OUT_CSV}, {OUT_REPORT}")
