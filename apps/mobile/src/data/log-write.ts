import type { DbAdapter } from '@nutai/db-adapter'
import { localDate, slotFor } from './date-utils'

/**
 * The one place that writes `meals` and `log_items` rows.
 *
 * Every way of logging food (a reviewed scan, a product picked from the database,
 * a saved entry, an ingredient added while editing) ends in the same two inserts,
 * so a new column is added here once. Takes a `DbAdapter` (usually the transaction
 * handle), so it runs under bare Node in tests like the rest of the data layer.
 */

export interface NewMeal {
  loggedAt: number
  photoUri?: string | null
  portionEatenFraction?: number
  engineId?: string | null
  promptVersion?: string | null
  schemaVersion?: string | null
  clampFlagsJson?: string | null
  title?: string | null
  note?: string | null
}

/** A complete (not pending) meal. Returns its id. */
export async function insertMeal(tx: DbAdapter, m: NewMeal): Promise<number> {
  const r = await tx.run(
    `INSERT INTO meals (logged_at, local_date, meal_slot, photo_uri, portion_eaten_fraction,
                        analysis_status, engine_id, prompt_version, schema_version,
                        clamp_flags_json, created_at, title, note)
     VALUES (?,?,?,?,?,'complete',?,?,?,?,?,?,?)`,
    [
      m.loggedAt,
      localDate(m.loggedAt),
      slotFor(m.loggedAt),
      m.photoUri ?? null,
      m.portionEatenFraction ?? 1,
      m.engineId ?? null,
      m.promptVersion ?? null,
      m.schemaVersion ?? null,
      m.clampFlagsJson ?? null,
      m.loggedAt,
      m.title ?? null,
      m.note ?? null,
    ],
  )
  return Number(r.lastInsertRowId)
}

export interface NewLogItem {
  foodId: number | null
  displayName: string
  grams: number
  gramPathway: string
  portionSource: string
  /** Per-100 g snapshot, copied in unscaled. */
  kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  fiber_g: number | null
  sugar_g: number | null
  sodium_mg: number | null
  isEstimate?: boolean
  macrosUserEdited?: boolean
  bandHalfPct?: number | null
  assumptionsJson?: string | null
}

export async function insertLogItem(
  tx: DbAdapter,
  mealId: number,
  item: NewLogItem,
  sortOrder: number,
  loggedAt: number,
): Promise<void> {
  await tx.run(
    `INSERT INTO log_items (meal_id, matched_food_id, matched_food_source, display_name, grams,
                            gram_pathway, portion_source,
                            snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g,
                            snap_fiber_g, snap_sugar_g, snap_sodium_mg,
                            is_estimate, macros_user_edited, band_half_pct,
                            assumptions_json, sort_order, logged_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      mealId,
      item.foodId,
      item.foodId != null ? 'corpus' : 'estimate',
      item.displayName,
      item.grams,
      item.gramPathway,
      item.portionSource,
      item.kcal,
      item.protein_g,
      item.fat_g,
      item.carbs_g,
      item.fiber_g,
      item.sugar_g,
      item.sodium_mg,
      item.isEstimate ? 1 : 0,
      item.macrosUserEdited ? 1 : 0,
      item.bandHalfPct ?? null,
      item.assumptionsJson ?? null,
      sortOrder,
      loggedAt,
    ],
  )
}
