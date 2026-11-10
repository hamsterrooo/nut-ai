import type { DbAdapter } from '@nutai/db-adapter'
import type { NutrientRow100g } from '@nutai/core-schema'
import { insertLogItem, insertMeal } from './log-write'

/**
 * A food picked directly off the Food Database search screen — no photo, no
 * model call. `nutrientSnapshot` is the resolved row's real per-100 g values;
 * `logManualFood` copies them in UNSCALED at log time, exactly like every other
 * logging path (the totals multiply by grams / 100 themselves), so a later
 * corpus rebuild can never move a historical log's numbers.
 *
 * This takes its `DbAdapter` as a parameter rather than reaching for repo.ts's
 * cached app singleton — same shape as `backup-core.ts` — specifically so it
 * is testable under plain Node against `@nutai/db-adapter/node`'s
 * `openMemoryDb()`. The singleton's `db()` calls `openUserDb()` in
 * `apps/mobile/src/db/expo-adapter.ts`, which imports `expo-sqlite`; that
 * import throws under Node, so any function that hard-codes it can only ever
 * be exercised inside a running app, never in this test suite.
 */
export interface ManualFoodSelection {
  foodId: number
  displayName: string
  grams: number
  nutrientSnapshot: NutrientRow100g
}

export async function logManualFood(h: DbAdapter, selection: ManualFoodSelection, now: number): Promise<number> {
  const n = selection.nutrientSnapshot

  return h.transaction(async (tx) => {
    const mealId = await insertMeal(tx, { loggedAt: now })
    await insertLogItem(
      tx,
      mealId,
      {
        foodId: selection.foodId,
        displayName: selection.displayName,
        grams: selection.grams,
        gramPathway: 'fndds_standard_portion',
        portionSource: 'db_search',
        kcal: n.kcal,
        protein_g: n.protein_g,
        fat_g: n.fat_g,
        carbs_g: n.carbs_g,
        fiber_g: n.fiber_g ?? null,
        sugar_g: n.sugar_g ?? null,
        sodium_mg: n.sodium_mg ?? null,
      },
      0,
      now,
    )
    return mealId
  })
}
