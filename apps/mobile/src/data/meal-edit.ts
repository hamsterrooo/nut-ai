import type { DbAdapter } from '@nutai/db-adapter'
import { insertLogItem } from './log-write'

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
        await insertLogItem(
          tx,
          id,
          {
            foodId: a.foodId,
            displayName: a.name,
            grams: a.grams,
            gramPathway: 'user_edited',
            portionSource: 'db_search',
            kcal: a.kcal,
            protein_g: a.protein,
            fat_g: a.fat,
            carbs_g: a.carbs,
            fiber_g: a.fiber,
            sugar_g: a.sugar,
            sodium_mg: a.sodium,
          },
          order++,
          now,
        )
      }
    }
  })
}

/**
 * Group logged meals so they show (and total) together. Nothing is merged: every
 * meal keeps its own ingredients, portion fraction, title and time, and ungrouping
 * gives back exactly what was there.
 *
 * The group id is the id of the earliest member. Meals already in a group pull that
 * whole group in, so grouping A+B with an existing group {C,D} gives {A,B,C,D}.
 * Pending meals are ignored. Returns the group id, or null when fewer than two
 * groupable meals were given.
 */
export async function groupMeals(h: DbAdapter, ids: number[]): Promise<number | null> {
  const unique = [...new Set(ids)]
  if (unique.length < 2) return null
  return h.transaction(async (tx) => {
    const marks = unique.map(() => '?').join(',')
    const picked = await tx.all<{ id: number; group_id: number | null }>(
      `SELECT id, group_id FROM meals
       WHERE id IN (${marks}) AND analysis_status IN ('complete','manual')
       ORDER BY logged_at, id`,
      unique,
    )
    if (picked.length < 2) return null

    const oldGroups = [...new Set(picked.map((m) => m.group_id).filter((g): g is number => g != null))]
    const members = new Set<number>(picked.map((m) => m.id))
    for (const g of oldGroups) {
      const rows = await tx.all<{ id: number }>('SELECT id FROM meals WHERE group_id = ?', [g])
      for (const r of rows) members.add(r.id)
    }
    const all = [...members]
    const first = await tx.get<{ id: number }>(
      `SELECT id FROM meals WHERE id IN (${all.map(() => '?').join(',')}) ORDER BY logged_at, id LIMIT 1`,
      all,
    )
    const gid = first!.id
    await tx.run(`UPDATE meals SET group_id = ? WHERE id IN (${all.map(() => '?').join(',')})`, [gid, ...all])
    return gid
  })
}

/** Dissolve a whole group. The meals are untouched. */
export async function ungroup(h: DbAdapter, groupId: number): Promise<void> {
  await h.run('UPDATE meals SET group_id = NULL WHERE group_id = ?', [groupId])
}

/**
 * Take one meal out of its group. A group left with a single meal is dissolved: a
 * group of one is just a meal.
 */
export async function removeFromGroup(h: DbAdapter, mealId: number): Promise<void> {
  await h.transaction(async (tx) => {
    const m = await tx.get<{ group_id: number | null }>('SELECT group_id FROM meals WHERE id = ?', [mealId])
    if (!m || m.group_id == null) return
    await tx.run('UPDATE meals SET group_id = NULL WHERE id = ?', [mealId])
    await dissolveIfAlone(tx, m.group_id)
  })
}

/** Clears a group that has fewer than two members left. Call after a member is removed. */
export async function dissolveIfAlone(h: DbAdapter, groupId: number): Promise<void> {
  const n = await h.get<{ c: number }>('SELECT COUNT(*) AS c FROM meals WHERE group_id = ?', [groupId])
  if ((n?.c ?? 0) < 2) await h.run('UPDATE meals SET group_id = NULL WHERE group_id = ?', [groupId])
}
