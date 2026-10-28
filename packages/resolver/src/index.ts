import type { DbAdapter } from '@nutai/db-adapter'
import { normalizeGtin } from './gtin.js'
import { matchLadder } from './query.js'
import {
  type Candidate,
  type ResolutionOutcome,
  type ScoringContext,
  decideOutcome,
  scoreCandidates,
} from './scoring.js'

export * from './gtin.js'
export * from './query.js'
export * from './scoring.js'

/**
 * Nutrition resolution — food name to database row.
 *
 * SPEC-accuracy-engine.md §5. The stage between "the model says this is grilled
 * chicken breast" and "165 kcal per 100 g, from FDC row 171077".
 *
 * Everything here is offline. No network call has ever been part of this stage,
 * on either inference path, which is what makes the whole repair loop free.
 */

export interface ResolvedFood {
  foodId: string
  name: string
  brand: string | null
  /** Per-100 g. Always. There is exactly one computational basis. */
  energyKcal: number | null
  proteinG: number | null
  fatG: number | null
  carbG: number | null
  fiberG: number | null
  sugarG: number | null
  sodiumMg: number | null
  servingSizeG: number | null
  servingDesc: string | null
  license: string
  source: string
}

const CANDIDATE_SQL = `
SELECT f.id            AS foodId,
       f.name          AS name,
       b.canonical_name AS brand,
       f.category      AS category,
       f.prep_facet    AS prepFacet,
       f.basis_confidence AS basisConfidence,
       f.serving_size_g   AS servingSizeG,
       f.energy_kcal      AS energyKcal,
       f.popularity_rank  AS popularityRank,
       f.completeness_score AS completenessScore,
       bm25(food_fts, 10.0, 8.0, 4.0) AS rawBm25
FROM food_fts
JOIN foods f ON f.id = food_fts.rowid
LEFT JOIN brands b ON b.id = f.brand_id
WHERE food_fts MATCH ?
ORDER BY rawBm25
LIMIT 50
`

const FOOD_BY_ID_SQL = `
SELECT f.id AS foodId, f.name AS name, b.canonical_name AS brand,
       f.energy_kcal AS energyKcal, f.protein_g AS proteinG, f.fat_g AS fatG,
       f.carb_g AS carbG, f.fiber_g AS fiberG, f.sugar_g AS sugarG,
       f.sodium_mg AS sodiumMg, f.serving_size_g AS servingSizeG,
       f.serving_desc AS servingDesc, f.license AS license, f.source AS source
FROM foods f
LEFT JOIN brands b ON b.id = f.brand_id
WHERE f.id = ?
`

/**
 * Barcode path — deterministic, single row, no scoring.
 *
 * Normalizes to a canonical 13-digit GTIN first, so a UPC-A scanned off a US
 * package finds the same row as its EAN-13 equivalent. Skipping that step
 * produces the most confusing bug class available here: the barcode is in the
 * database, the scan succeeds, and the lookup misses.
 */
/**
 * SQLite returns `foods.id` as an INTEGER, but every consumer treats a food id as
 * an opaque string key (it is also used for `user_foods:` and `fdc:` prefixed
 * concept keys). Coercing at this boundary keeps the declared type honest —
 * without it, TypeScript believes `foodId: string` while the runtime hands back a
 * number, and every `===` comparison downstream silently fails.
 */
function coerceIds<T extends { foodId: unknown }>(row: T | null): (Omit<T, 'foodId'> & { foodId: string }) | null {
  return row == null ? null : { ...row, foodId: String(row.foodId) }
}

export async function resolveByBarcode(
  db: DbAdapter,
  rawBarcode: string,
): Promise<ResolvedFood | null> {
  const gtin = normalizeGtin(rawBarcode)
  if (!gtin) return null

  // Match the stored value whether it was indexed zero-padded or not.
  const unpadded = gtin.replace(/^0+/, '')
  const row = await db.get<ResolvedFood>(
    `${FOOD_BY_ID_SQL.replace('WHERE f.id = ?', 'WHERE f.barcode = ? OR f.barcode = ?')}`,
    [gtin, unpadded],
  )
  return coerceIds(row)
}

export async function loadFood(db: DbAdapter, foodId: string): Promise<ResolvedFood | null> {
  return coerceIds(await db.get<ResolvedFood>(FOOD_BY_ID_SQL, [foodId]))
}

export interface ResolveResult {
  outcome: ResolutionOutcome
  /** How far down the broadening ladder we had to go. 0 = exact first try. */
  ladderStep: number
  /** True when every rung returned nothing — this is what the 5% trigger counts. */
  zeroHit: boolean
}

/**
 * Text resolution: FTS5 candidate generation, six-signal scoring, and the
 * two-part auto-accept decision.
 */
export async function resolveByText(
  db: DbAdapter,
  ctx: ScoringContext,
): Promise<ResolveResult> {
  const ladder = matchLadder(ctx.canonicalFoodKey)

  for (let step = 0; step < ladder.length; step++) {
    const expr = ladder[step]
    if (!expr) continue

    let rows: Candidate[]
    try {
      rows = await db.all<Candidate>(CANDIDATE_SQL, [expr])
    } catch {
      // A malformed MATCH expression must not take down a scan. Move down the
      // ladder rather than surfacing a SQL error to someone photographing lunch.
      continue
    }

    // Home-cooked: a brand on the row means a shop-bought product. Skip those and
    // let the next, broader rung look for a generic row instead.
    if (ctx.homemade) rows = rows.filter((r) => !r.brand)

    if (rows.length === 0) continue

    // Same integer-vs-string coercion as loadFood — candidate ids flow straight
    // into loadFood and into IngredientRow.sourceFoodId.
    const scored = scoreCandidates(
      rows.map((r) => ({ ...r, foodId: String(r.foodId) })),
      ctx,
    )
    return { outcome: decideOutcome(scored), ladderStep: step, zeroHit: false }
  }

  return { outcome: { kind: 'miss' }, ladderStep: ladder.length, zeroHit: true }
}
