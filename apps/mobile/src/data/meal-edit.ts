import type { DbAdapter } from '@nutai/db-adapter'

/**
 * Editing a logged meal: name, description, the grams of each ingredient, and
 * removal of ingredients.
 *
 * Takes its `DbAdapter` as a parameter (same shape as manual-food.ts and
 * backup-core.ts) so it runs under bare Node against an in-memory database.
 * Nutrient snapshots are never touched: an edit changes the quantity, and the
 * per-100 g values copied in at log time stay exactly as they were.
 */

export interface MealItemDetail {
  id: number
  name: string
  grams: number
  kcalPer100: number
  proteinPer100: number
  carbsPer100: number
  fatPer100: number
  /** Local epoch ms the ingredient was added. */
  addedAt: number
}

export interface MealDetail {
  id: number
  title: string | null
  note: string | null
  loggedAt: number
  portionEaten: number
  items: MealItemDetail[]
}

export async function loadMealDetail(h: DbAdapter, id: number): Promise<MealDetail | null> {
  const meal = await h.get<{
    id: number
    title: string | null
    note: string | null
    logged_at: number
    portion_eaten_fraction: number
  }>('SELECT id, title, note, logged_at, portion_eaten_fraction FROM meals WHERE id = ?', [id])
  if (!meal) return null

  const items = await h.all<{
    id: number
    display_name: string
    grams: number
    snap_energy_kcal: number | null
    snap_protein_g: number | null
    snap_carb_g: number | null
    snap_fat_g: number | null
    logged_at: number
  }>(
    `SELECT id, display_name, grams, snap_energy_kcal, snap_protein_g, snap_carb_g, snap_fat_g, logged_at
     FROM log_items WHERE meal_id = ? ORDER BY sort_order, id`,
    [id],
  )

  return {
    id: meal.id,
    title: meal.title,
    note: meal.note,
    loggedAt: meal.logged_at,
    portionEaten: meal.portion_eaten_fraction,
    items: items.map((r) => ({
      id: r.id,
      name: r.display_name,
      grams: r.grams,
      kcalPer100: r.snap_energy_kcal ?? 0,
      proteinPer100: r.snap_protein_g ?? 0,
      carbsPer100: r.snap_carb_g ?? 0,
      fatPer100: r.snap_fat_g ?? 0,
      addedAt: r.logged_at,
    })),
  }
}

export interface MealEdit {
  title: string
  note: string
  /** New grams by log_items id. Ids not present keep their grams. */
  grams: Record<number, number>
  /** log_items ids to delete. */
  remove: number[]
  /** Foods swapped in for existing ingredients, by log_items id. Grams stay. */
  replace?: Record<number, Snapshot>
  /** New ingredients, with their grams. */
  add?: Array<Snapshot & { grams: number }>
}

/** Per-100 g values of a product picked to replace or add an ingredient. */
export interface Snapshot {
  foodId: number | null
  name: string
  kcal: number
  protein: number
  fat: number
  carbs: number
  fiber: number | null
  sugar: number | null
  sodium: number | null
}

/** Empty strings are stored as NULL so "no title" and "cleared title" are the same thing. */
export async function saveMealEdit(h: DbAdapter, id: number, edit: MealEdit): Promise<void> {
  await h.transaction(async (tx) => {
    await tx.run('UPDATE meals SET title = ?, note = ? WHERE id = ?', [
      edit.title.trim() || null,
      edit.note.trim() || null,
      id,
    ])
    for (const [itemId, grams] of Object.entries(edit.grams)) {
      if (!Number.isFinite(grams) || grams < 0) continue
      await tx.run('UPDATE log_items SET grams = ? WHERE id = ? AND meal_id = ?', [grams, Number(itemId), id])
    }
    for (const itemId of edit.remove) {
      await tx.run('DELETE FROM log_items WHERE id = ? AND meal_id = ?', [itemId, id])
    }
    for (const [itemId, s] of Object.entries(edit.replace ?? {})) {
      await tx.run(
        `UPDATE log_items SET matched_food_id = ?, matched_food_source = 'corpus', display_name = ?,
                portion_source = 'db_search', is_estimate = 0, macros_user_edited = 0,
                snap_energy_kcal = ?, snap_protein_g = ?, snap_fat_g = ?, snap_carb_g = ?,
                snap_fiber_g = ?, snap_sugar_g = ?, snap_sodium_mg = ?
         WHERE id = ? AND meal_id = ?`,
        [s.foodId, s.name, s.kcal, s.protein, s.fat, s.carbs, s.fiber, s.sugar, s.sodium, Number(itemId), id],
      )
    }
    if (edit.add && edit.add.length > 0) {
      const max = await tx.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM log_items WHERE meal_id = ?', [id])
      let order = (max?.m ?? -1) + 1
      const now = Date.now()
      for (const a of edit.add) {
        if (!Number.isFinite(a.grams) || a.grams <= 0) continue
        await tx.run(
          `INSERT INTO log_items (meal_id, matched_food_id, matched_food_source, display_name, grams,
                                  gram_pathway, portion_source, snap_energy_kcal, snap_protein_g, snap_fat_g,
                                  snap_carb_g, snap_fiber_g, snap_sugar_g, snap_sodium_mg,
                                  is_estimate, macros_user_edited, sort_order, logged_at)
           VALUES (?,?,'corpus',?,?,'user_edited','db_search',?,?,?,?,?,?,?,0,0,?,?)`,
          [id, a.foodId, a.name, a.grams, a.kcal, a.protein, a.fat, a.carbs, a.fiber, a.sugar, a.sodium, order++, now],
        )
      }
    }
  })
}

/**
 * Merge several logged meals into the earliest one.
 *
 * Totals must not move, and each meal carries its own portion_eaten_fraction, so a
 * fraction other than 1 is folded into the grams of that meal's items first and the
 * merged meal is set to 1. Pending meals are ignored. Returns the surviving meal id,
 * or null when fewer than two mergeable meals were given.
 */
export async function mergeMeals(h: DbAdapter, ids: number[]): Promise<number | null> {
  const unique = [...new Set(ids)]
  if (unique.length < 2) return null
  return h.transaction(async (tx) => {
    const marks = unique.map(() => '?').join(',')
    const meals = await tx.all<{
      id: number
      title: string | null
      note: string | null
      portion_eaten_fraction: number
    }>(
      `SELECT id, title, note, portion_eaten_fraction FROM meals
       WHERE id IN (${marks}) AND analysis_status IN ('complete','manual')
       ORDER BY logged_at, id`,
      unique,
    )
    if (meals.length < 2) return null
    const target = meals[0]!

    for (const m of meals) {
      if (m.portion_eaten_fraction !== 1) {
        await tx.run('UPDATE log_items SET grams = grams * ? WHERE meal_id = ?', [m.portion_eaten_fraction, m.id])
      }
    }
    for (const m of meals.slice(1)) {
      const max = await tx.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM log_items WHERE meal_id = ?', [target.id])
      await tx.run('UPDATE log_items SET meal_id = ?, sort_order = sort_order + ? WHERE meal_id = ?', [
        target.id,
        (max?.m ?? -1) + 1,
        m.id,
      ])
      await tx.run('UPDATE scan_cost_ledger SET meal_id = ? WHERE meal_id = ?', [target.id, m.id])
      await tx.run('DELETE FROM meals WHERE id = ?', [m.id])
    }

    const title = meals.find((m) => m.title?.trim())?.title ?? null
    const note = meals.map((m) => m.note?.trim()).filter(Boolean).join('\n') || null
    await tx.run('UPDATE meals SET portion_eaten_fraction = 1.0, title = ?, note = ? WHERE id = ?', [
      title,
      note,
      target.id,
    ])
    return target.id
  })
}
