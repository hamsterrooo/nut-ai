import type { DbAdapter } from '@nutai/db-adapter'
import { localDate, slotFor } from './date-utils'

/**
 * History and saved entries.
 *
 * A saved entry is a named list of ingredients with grams, kept in the existing
 * `saved_meals` table. Nutrient values inside are per 100 g like every snapshot in
 * the app, so logging one again is the same arithmetic as logging anything else.
 * Takes its `DbAdapter` as a parameter so it runs under bare Node in tests.
 */

/** One ingredient of a saved entry. Nutrient values are per 100 g. */
export interface SavedItem {
  foodId: number | null
  name: string
  grams: number
  kcal: number
  protein: number
  fat: number
  carbs: number
  fiber: number | null
  sugar: number | null
  sodium: number | null
}

export interface Totals {
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

export interface SavedEntry extends Totals {
  id: number
  name: string
  items: SavedItem[]
  useCount: number
}

export interface HistoryEntry extends Totals {
  id: number
  loggedAt: number
  name: string
}

export function itemsTotals(items: readonly SavedItem[]): Totals {
  const t: Totals = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  for (const i of items) {
    const f = i.grams / 100
    t.kcal += i.kcal * f
    t.protein_g += i.protein * f
    t.carbs_g += i.carbs * f
    t.fat_g += i.fat * f
  }
  return t
}

function parseItems(json: string): SavedItem[] {
  try {
    const v: unknown = JSON.parse(json)
    if (!Array.isArray(v)) return []
    return (v as SavedItem[]).filter((i) => i != null && typeof i.name === 'string' && Number.isFinite(i.grams))
  } catch {
    return []
  }
}

async function insertSaved(
  h: DbAdapter,
  name: string,
  items: SavedItem[],
  now: number,
): Promise<{ id: number; created: boolean }> {
  const json = JSON.stringify(items)
  const existing = await h.get<{ id: number }>('SELECT id FROM saved_meals WHERE items_json = ? LIMIT 1', [json])
  if (existing) return { id: existing.id, created: false }
  const r = await h.run('INSERT INTO saved_meals (name, items_json, use_count, created_at) VALUES (?,?,0,?)', [
    name.slice(0, 80),
    json,
    now,
  ])
  return { id: Number(r.lastInsertRowId), created: true }
}

/** The ingredients of a logged meal, with its eaten fraction folded into the grams. */
export async function itemsOfMeal(
  h: DbAdapter,
  mealId: number,
): Promise<{ name: string; items: SavedItem[] } | null> {
  const meal = await h.get<{ title: string | null; portion_eaten_fraction: number }>(
    'SELECT title, portion_eaten_fraction FROM meals WHERE id = ?',
    [mealId],
  )
  if (!meal) return null
  const rows = await h.all<{
    matched_food_id: number | null
    display_name: string
    grams: number
    snap_energy_kcal: number | null
    snap_protein_g: number | null
    snap_fat_g: number | null
    snap_carb_g: number | null
    snap_fiber_g: number | null
    snap_sugar_g: number | null
    snap_sodium_mg: number | null
  }>(
    `SELECT matched_food_id, display_name, grams, snap_energy_kcal, snap_protein_g, snap_fat_g,
            snap_carb_g, snap_fiber_g, snap_sugar_g, snap_sodium_mg
     FROM log_items WHERE meal_id = ? ORDER BY sort_order, id`,
    [mealId],
  )
  if (rows.length === 0) return null
  const items: SavedItem[] = rows.map((r) => ({
    foodId: r.matched_food_id,
    name: r.display_name,
    grams: r.grams * meal.portion_eaten_fraction,
    kcal: r.snap_energy_kcal ?? 0,
    protein: r.snap_protein_g ?? 0,
    fat: r.snap_fat_g ?? 0,
    carbs: r.snap_carb_g ?? 0,
    fiber: r.snap_fiber_g,
    sugar: r.snap_sugar_g,
    sodium: r.snap_sodium_mg,
  }))
  return { name: meal.title?.trim() || items.map((i) => i.name).join(', '), items }
}

/** Save a logged meal. Saving the same ingredients twice returns the existing entry. */
export async function saveMeal(h: DbAdapter, mealId: number, now: number): Promise<{ id: number; created: boolean } | null> {
  const m = await itemsOfMeal(h, mealId)
  return m ? insertSaved(h, m.name, m.items, now) : null
}

/** Save one product, e.g. straight from the database search. */
export async function saveProduct(h: DbAdapter, item: SavedItem, now: number): Promise<{ id: number; created: boolean }> {
  return insertSaved(h, item.name, [item], now)
}

export async function listSaved(h: DbAdapter): Promise<SavedEntry[]> {
  const rows = await h.all<{ id: number; name: string; items_json: string; use_count: number }>(
    `SELECT id, name, items_json, use_count FROM saved_meals
     ORDER BY use_count DESC, COALESCE(last_used_at, created_at) DESC`,
  )
  return rows
    .map((r) => {
      const items = parseItems(r.items_json)
      return { id: r.id, name: r.name, items, useCount: r.use_count, ...itemsTotals(items) }
    })
    .filter((e) => e.items.length > 0)
}

export async function deleteSaved(h: DbAdapter, id: number): Promise<void> {
  await h.run('DELETE FROM saved_meals WHERE id = ?', [id])
}

/** Log ingredients as a new meal now. The title is kept only when it says more than the names. */
export async function logItems(h: DbAdapter, name: string, items: readonly SavedItem[], now: number): Promise<number> {
  const joined = items.map((i) => i.name).join(', ')
  return h.transaction(async (tx) => {
    const meal = await tx.run(
      `INSERT INTO meals (logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status, created_at, title)
       VALUES (?,?,?,1.0,'complete',?,?)`,
      [now, localDate(now), slotFor(now), now, name !== joined ? name : null],
    )
    const mealId = Number(meal.lastInsertRowId)
    for (const [i, it] of items.entries()) {
      await tx.run(
        `INSERT INTO log_items (meal_id, matched_food_id, matched_food_source, display_name, grams,
                                gram_pathway, portion_source, snap_energy_kcal, snap_protein_g, snap_fat_g,
                                snap_carb_g, snap_fiber_g, snap_sugar_g, snap_sodium_mg,
                                is_estimate, macros_user_edited, sort_order, logged_at)
         VALUES (?,?,?,?,?,'user_edited','db_search',?,?,?,?,?,?,?,0,0,?,?)`,
        [
          mealId,
          it.foodId,
          it.foodId != null ? 'corpus' : 'estimate',
          it.name,
          it.grams,
          it.kcal,
          it.protein,
          it.fat,
          it.carbs,
          it.fiber,
          it.sugar,
          it.sodium,
          i,
          now,
        ],
      )
    }
    return mealId
  })
}

export async function logSaved(h: DbAdapter, id: number, now: number): Promise<number | null> {
  const row = await h.get<{ name: string; items_json: string }>('SELECT name, items_json FROM saved_meals WHERE id = ?', [id])
  if (!row) return null
  const items = parseItems(row.items_json)
  if (items.length === 0) return null
  const mealId = await logItems(h, row.name, items, now)
  await h.run('UPDATE saved_meals SET use_count = use_count + 1, last_used_at = ? WHERE id = ?', [now, id])
  return mealId
}

/** Log a meal from the history again, as a new meal now. */
export async function logAgain(h: DbAdapter, mealId: number, now: number): Promise<number | null> {
  const m = await itemsOfMeal(h, mealId)
  return m ? logItems(h, m.name, m.items, now) : null
}

/** Logged meals, newest first, across all days. */
export async function listHistory(h: DbAdapter, limit = 150): Promise<HistoryEntry[]> {
  const rows = await h.all<{
    id: number
    logged_at: number
    title: string | null
    names: string | null
    kcal: number | null
    p: number | null
    c: number | null
    f: number | null
  }>(
    `SELECT m.id, m.logged_at, m.title,
       (SELECT group_concat(display_name, ', ')
          FROM (SELECT display_name FROM log_items WHERE meal_id = m.id ORDER BY sort_order)) AS names,
       COALESCE((SELECT SUM(snap_energy_kcal * grams / 100.0) FROM log_items WHERE meal_id = m.id), 0)
         * m.portion_eaten_fraction AS kcal,
       COALESCE((SELECT SUM(snap_protein_g * grams / 100.0) FROM log_items WHERE meal_id = m.id), 0)
         * m.portion_eaten_fraction AS p,
       COALESCE((SELECT SUM(snap_carb_g * grams / 100.0) FROM log_items WHERE meal_id = m.id), 0)
         * m.portion_eaten_fraction AS c,
       COALESCE((SELECT SUM(snap_fat_g * grams / 100.0) FROM log_items WHERE meal_id = m.id), 0)
         * m.portion_eaten_fraction AS f
     FROM meals m
     WHERE m.analysis_status IN ('complete','manual')
     ORDER BY m.logged_at DESC, m.id DESC
     LIMIT ?`,
    [limit],
  )
  return rows.map((r) => ({
    id: r.id,
    loggedAt: r.logged_at,
    name: r.title?.trim() || r.names || 'Posiłek',
    kcal: r.kcal ?? 0,
    protein_g: r.p ?? 0,
    carbs_g: r.c ?? 0,
    fat_g: r.f ?? 0,
  }))
}
