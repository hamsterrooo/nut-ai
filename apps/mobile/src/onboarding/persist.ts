import Storage from 'expo-sqlite/kv-store'
import { migrate } from '@nutai/db-adapter'
import type { CalorieTarget, MacroTargets } from '@nutai/goals'
import { openUserDb } from '../db/expo-adapter'
import { ONBOARDING_DONE_KEY } from './done-key'
import {
  activityFor,
  ageFrom,
  inferredGoal,
  type OnboardingAnswers,
} from './store'

/**
 * Write the onboarding result into `user.db`.
 *
 * The `goals` table is APPEND-ONLY. A goal change is a new row, never an UPDATE,
 * so a historical day can always be read against the target that was actually in
 * force that day. Recomputing March against August's target would silently
 * rewrite whether someone hit their goal three months ago.
 *
 * `target_raw_kcal` and `floor_applied` are stored alongside the final target,
 * because "1,200 because we clamped it" and "1,200 because that is your maths"
 * are different facts and the Settings screen has to be able to tell them apart.
 */
export async function persistOnboarding(
  answers: OnboardingAnswers,
  target: CalorieTarget,
  macros: MacroTargets,
): Promise<void> {
  const db = await openUserDb()
  const now = Date.now()

  await migrate(db, now)

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT OR REPLACE INTO user_profile
         (id, sex, birth_year, birth_month, birth_day, height_cm, activity_level, units,
          weight_visible, gamification, inference_path, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        answers.sex,
        answers.birthYear,
        answers.birthMonth,
        answers.birthDay,
        answers.heightCm,
        activityFor(answers.workoutsPerWeek),
        answers.units,
        1,
        answers.provider && answers.provider !== 'none' ? 'cloud' : 'none',
        now,
      ],
    )

    await tx.run(
      `INSERT INTO goals
         (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
          floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        now,
        inferredGoal(answers),
        null,
        target.target,
        target.targetRaw,
        target.floorApplied ? 1 : 0,
        macros.protein_g,
        macros.fat_g,
        macros.carbs_g,
        target.bmr,
        target.tdee,
      ],
    )

    if (answers.weightKg != null) {
      const localDate = new Date(now).toISOString().slice(0, 10)
      await tx.run(
        'INSERT OR REPLACE INTO weight_entries (local_date, weight_kg, logged_at) VALUES (?,?,?)',
        [localDate, answers.weightKg, now],
      )
    }

    // Every setting below has a consumer. See the note at the top of store.ts:
    // a field written here with nothing reading it means the screen that asked
    // for it should be deleted, not the row.
    const settings: Array<[string, string]> = [
      ['diet.style', answers.dietStyle ?? 'balanced'],
      ['goal.desiredWeightKg', String(answers.desiredWeightKg ?? answers.weightKg ?? '')],
      // THE canonical keys the scan orchestrator reads. The apikey screen
      // writes these on verify too; writing here as well covers the skip path
      // and keeps one vocabulary — the old inference.* mirror keys are gone.
      ['provider', answers.provider ?? 'none'],
      ['provider_model', answers.providerModel ?? ''],
      ['age.years', String(ageFrom(answers, now))],
    ]

    for (const [key, value] of settings) {
      await tx.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [key, value])
    }
  })

  await db.close()
  await Storage.setItem(ONBOARDING_DONE_KEY, 'true')
}
