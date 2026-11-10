import Storage from 'expo-sqlite/kv-store'
import { migrate } from '@nutai/db-adapter'
import type { Plan } from '@nutai/goals'
import { localDate } from '../data/date-utils'
import { insertGoal } from '../data/goal-write'
import { openUserDb } from '../db/expo-adapter'
import { ONBOARDING_DONE_KEY } from './done-key'
import { activityFor, type OnboardingAnswers } from './store'

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
  plan: Plan,
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

    await insertGoal(tx, {
      effectiveFrom: now,
      goalType: plan.goal,
      targetKcal: plan.target.target,
      targetRawKcal: plan.target.targetRaw,
      floorApplied: plan.target.floorApplied,
      ...plan.macros,
      bmr: plan.target.bmr,
      tdee: plan.target.tdee,
      adaptive: true,
    })

    if (answers.weightKg != null) {
      await tx.run(
        'INSERT OR REPLACE INTO weight_entries (local_date, weight_kg, logged_at) VALUES (?,?,?)',
        [localDate(now), answers.weightKg, now],
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
    ]

    for (const [key, value] of settings) {
      await tx.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [key, value])
    }
  })

  await db.close()
  await Storage.setItem(ONBOARDING_DONE_KEY, 'true')
}
