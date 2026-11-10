import type { DbAdapter } from '@nutai/db-adapter'

/**
 * The one place that appends to `goals`.
 *
 * `goals` is append-only: a change of goal is a new row, never an UPDATE, so a
 * historical day is always read against the target that was in force that day.
 * Onboarding, a recomputed plan, a hand-set target and the adaptive loop all end
 * here.
 */

export interface NewGoal {
  effectiveFrom: number
  goalType: string
  targetKcal: number
  /** What the arithmetic produced before the safety floor. */
  targetRawKcal: number
  floorApplied: boolean
  protein_g: number
  fat_g: number
  carbs_g: number
  bmr: number
  tdee: number
  /** A hand-set target turns the adaptive loop off. */
  adaptive: boolean
}

export async function insertGoal(db: DbAdapter, g: NewGoal): Promise<void> {
  await db.run(
    `INSERT INTO goals
       (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
        floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive)
     VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?)`,
    [
      g.effectiveFrom,
      g.goalType,
      g.targetKcal,
      g.targetRawKcal,
      g.floorApplied ? 1 : 0,
      g.protein_g,
      g.fat_g,
      g.carbs_g,
      g.bmr,
      g.tdee,
      g.adaptive ? 1 : 0,
    ],
  )
}
