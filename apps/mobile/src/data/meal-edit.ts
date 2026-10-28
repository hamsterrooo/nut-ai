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
  })
}
