/**
 * Open Food Facts (Poland) tier.
 *
 * Input is a committed, pre-filtered snapshot: tools/nutrition-data/data/off-pl.csv,
 * produced by scripts/off_export.py from the OFF Parquet dump. The CSV is the
 * contract; this module validates its header and fails loudly on drift, in the
 * same spirit as the USDA stage in build.mjs.
 *
 * Rules, each one earned by looking at the real data:
 *  - OFF wins barcode lookups. The USDA tier here carries no barcodes, and for a
 *    Polish product the OFF row comes from the Polish label.
 *  - Barcodes are stored exactly as a scanner emits them (8 or 13 digits, valid
 *    GS1 check digit). startBarcodeScan queries `barcode = ?` with the raw scan,
 *    so storing a padded or reshaped form would make EAN-8 (Lidl) codes miss.
 *  - Names and brands are HTML-unescaped; OFF data contains literal &quot; etc.
 *  - alcohol_g above 56 per 100 g is impossible (40% ABV spirit is ~32 g) and
 *    marks a corrupt row; the whole row is dropped.
 *  - is_alcoholic needs a real drink: alcohol_g >= 2 AND a drink-like name or
 *    category. Trace values (0.01 g in ketchup) and 99% chocolate must not set it.
 *  - category stays NULL. OFF category tags are a different taxonomy from the one
 *    the model emits, and the resolver's category prior scores a mismatch as 0
 *    but a NULL as neutral, so tags would only ever hurt.
 *  - popularity_rank puts every OFF row after every USDA row (ordered by OFF scan
 *    count), so branded products never outrank generic USDA rows for English
 *    photo-scan keys.
 */

import { stat } from 'node:fs/promises'

export const OFF_REQUIRED_COLUMNS = [
  'code', 'name', 'name_lang', 'brand',
  'energy_kcal', 'protein_g', 'fat_g', 'sat_fat_g', 'carb_g', 'fiber_g', 'sugar_g', 'sodium_mg',
  'basis_confidence', 'alcohol_g', 'serving_size_g', 'serving_desc',
  'unique_scans_n', 'updated_at',
]

const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' }

export function unescapeHtml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** GS1 mod-10 check, same rule as packages/resolver/src/gtin.ts. */
function validGtin(d) {
  if (!/^\d+$/.test(d) || d.length < 2) return false
  let sum = 0
  ;[...d.slice(0, -1)].reverse().forEach((c, i) => { sum += i % 2 === 0 ? Number(c) * 3 : Number(c) })
  return (10 - (sum % 10)) % 10 === Number(d.slice(-1))
}

const DRINK_RE =
  /piwo|wódk|wodk|wino|wina|cydr|likier|nalewk|koniak|whisk|whiskey|rum\b|gin\b|brandy|tequila|prosecco|szampan|beer|vodka|wine|cider|liqueur|lager|\bipa\b|champagne|spirit/i

export async function readOffRows(csvPath, readCsv) {
  try {
    await stat(csvPath)
  } catch {
    throw new Error(
      `OFF snapshot missing: ${csvPath}\n` +
        `  Put the exported off_pl.csv there (see scripts/off_export.py), or set SKIP_OFF=1 to build USDA only.`,
    )
  }

  const stats = {
    read: 0, kept: 0,
    droppedNoName: 0, droppedNoEnergy: 0, droppedAlcohol: 0,
    barcodes: 0, barcodeInvalid: 0, barcodeDuplicate: 0,
    alcoholic: 0,
  }
  const seenBarcodes = new Set()
  const rows = []

  const { header } = await readCsv(csvPath, (r) => {
    stats.read++
    const name = unescapeHtml((r.name ?? '').trim())
    if (name.length < 2) { stats.droppedNoName++; return }

    const kcal = num(r.energy_kcal)
    if (kcal == null) { stats.droppedNoEnergy++; return }

    const alcoholG = num(r.alcohol_g) ?? 0
    if (alcoholG > 56) { stats.droppedAlcohol++; return }

    const brand = unescapeHtml((r.brand ?? '').trim()) || null

    let barcode = null
    const code = (r.code ?? '').trim()
    if ((code.length === 8 || code.length === 13) && validGtin(code)) {
      if (seenBarcodes.has(code)) stats.barcodeDuplicate++
      else { seenBarcodes.add(code); barcode = code; stats.barcodes++ }
    } else {
      stats.barcodeInvalid++
    }

    const serving = num(r.serving_size_g)
    const isAlcoholic = alcoholG >= 2 && (DRINK_RE.test(name) || DRINK_RE.test(r.category ?? '')) ? 1 : 0
    if (isAlcoholic) stats.alcoholic++

    const updatedSec = num(r.updated_at)
    rows.push({
      code,
      name,
      brand,
      barcode,
      basisConfidence: r.basis_confidence === 'medium' ? 'medium' : 'high',
      servingSizeG: serving != null && serving > 0 && serving <= 2000 ? serving : null,
      servingDesc: unescapeHtml((r.serving_desc ?? '').trim()) || null,
      isAlcoholic,
      kcal,
      protein: num(r.protein_g),
      fat: num(r.fat_g),
      satFat: num(r.sat_fat_g),
      carb: num(r.carb_g),
      fiber: num(r.fiber_g),
      sugar: num(r.sugar_g),
      sodiumMg: num(r.sodium_mg),
      scans: num(r.unique_scans_n) ?? 0,
      updatedAt: updatedSec != null ? updatedSec * 1000 : null,
    })
    stats.kept++
  })

  const missing = OFF_REQUIRED_COLUMNS.filter((c) => !header.includes(c))
  if (missing.length > 0) {
    throw new Error(
      `HEADER MISMATCH in ${csvPath}\n` +
        `  actual columns: ${header.join(', ')}\n` +
        `  MISSING:        ${missing.join(', ')}\n` +
        `  Re-export with scripts/off_export.py; do not edit the CSV by hand.`,
    )
  }

  // Deterministic popularity order: most scanned first, code as the tiebreak.
  rows.sort((a, b) => b.scans - a.scans || (a.code < b.code ? -1 : 1))
  return { rows, stats }
}

/**
 * Inserts OFF rows after the USDA rows. Must run inside the caller's transaction.
 * Returns the last row id used.
 */
export function insertOffRows(db, rows, lastRowId) {
  const insertBrand = db.prepare('INSERT INTO brands (id, canonical_name) VALUES (?,?)')
  const insertFood = db.prepare(`
    INSERT INTO foods (id, source, source_id, name, brand_id, category, basis, basis_confidence,
                       serving_size_g, serving_desc, barcode, is_alcoholic,
                       energy_kcal, protein_g, fat_g, sat_fat_g, carb_g, fiber_g, sugar_g, sodium_mg,
                       completeness_score, popularity_rank, license, updated_at)
    VALUES (?, 'off', ?, ?, ?, NULL, 'per_100g', ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, 'ODbL-1.0', ?)
  `)
  const insertFts = db.prepare('INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (?,?,?,?)')
  const insertTri = db.prepare('INSERT INTO food_fts_trigram (rowid, name) VALUES (?,?)')

  const brandIds = new Map()
  let brandId = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM brands').get().m
  let rowId = lastRowId
  const rankBase = lastRowId

  rows.forEach((r, i) => {
    let bid = null
    if (r.brand) {
      const key = r.brand.toLowerCase()
      bid = brandIds.get(key) ?? null
      if (bid == null) {
        bid = ++brandId
        brandIds.set(key, bid)
        insertBrand.run(bid, r.brand)
      }
    }

    rowId++
    const present = [r.kcal, r.protein, r.fat, r.carb].filter((v) => v != null).length
    insertFood.run(
      rowId, r.code, r.name, bid, r.basisConfidence,
      r.servingSizeG, r.servingDesc, r.barcode, r.isAlcoholic,
      r.kcal, r.protein, r.fat, r.satFat, r.carb, r.fiber, r.sugar, r.sodiumMg,
      present / 4, rankBase + i + 1, r.updatedAt,
    )
    insertFts.run(rowId, r.name, r.brand ?? '', '')
    insertTri.run(rowId, r.name)
  })

  return rowId
}
