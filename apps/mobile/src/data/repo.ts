import { pluralPl } from '../i18n/format'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import {
  computeCalorieTarget,
  computeMacros,
  computeTrend,
  isDayCompleteEnough,
  LB_PER_KG,
  retargetFromTdee,
  safeFloor,
  trendSlopeLbPerWeek,
  updateAdaptiveTdee,
  type ActivityLevel,
  type CalorieTarget,
  type Goal,
  type MacroTargets,
  type Sex,
  type WeightPoint,
} from '@nutai/goals'
import Storage from 'expo-sqlite/kv-store'
import { ONBOARDING_DONE_KEY } from '../onboarding/done-key'
import { inferredGoal } from '../onboarding/store'
import { EXPORT_TABLES, WIPE_ONLY_TABLES } from './backup-core'
import { localDate, slotFor } from './date-utils'
import { clearCredential } from '../inference/credentials'
import { disconnectPublik } from '../inference/publik'
import { openUserDb } from '../db/expo-adapter'

export { localDate, slotFor }

/**
 * The read/write layer over `user.db`.
 *
 * Every screen goes through here rather than holding its own SQL, so the
 * invariants live in one place: goals are append-only, day totals are always
 * derived from log_items rather than stored, and the adaptive loop can never run
 * on days it should not admit.
 */

let cached: DbAdapter | null = null

export async function db(): Promise<DbAdapter> {
  if (cached) return cached
  const handle = await openUserDb()
  await migrate(handle, Date.now())
  cached = handle
  return handle
}


/**
 * Wipe every local trace and send the app back to the first onboarding screen.
 *
 * Deletes user data, drops the stored API credentials out of the Keychain,
 * disconnects publik API (revoking this phone's key on the server, best
 * effort), and clears the completion flag. The bundled nutrition corpus is left alone — it is
 * a read-only build artifact, not user data, and re-importing 4.7 MB to prove a
 * point would just make this slow.
 */
export async function resetEverything(): Promise<void> {
  const h = await db()
  // ONE source of truth for "what counts as user data": the backup lists.
  // Children before parents, so foreign keys never block the wipe.
  const tables: string[] = [...([...EXPORT_TABLES] as string[]).reverse(), ...WIPE_ONLY_TABLES]
  await h.transaction(async (tx) => {
    for (const t of tables) {
      // A missing table is not an error here — an interrupted migration should
      // still be resettable, which is exactly when someone reaches for this.
      try {
        await tx.run(`DELETE FROM ${t}`)
      } catch {
        /* table absent */
      }
    }
  })

  for (const p of ['anthropic', 'openai', 'google'] as const) {
    await clearCredential(p)
  }
  await disconnectPublik()

  await Storage.removeItem(ONBOARDING_DONE_KEY)
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface CurrentGoal {
  goalType: Goal
  targetKcal: number
  targetRawKcal: number
  floorApplied: boolean
  protein_g: number
  fat_g: number
  carbs_g: number
  bmr: number
  tdee: number
  adaptive: boolean
  effectiveFrom: number
}

/**
 * The goal in force right now.
 *
 * `goals` is append-only, so "current" means the newest row — and a historical
 * day can still be read against whichever row was in force that day. Recomputing
 * March against August's target would silently rewrite whether someone hit their
 * goal three months ago.
 */
export async function currentGoal(): Promise<CurrentGoal | null> {
  const h = await db()
  const row = await h.get<{
    goal_type: string
    target_kcal: number
    target_raw_kcal: number
    floor_applied: number
    protein_g: number
    fat_g: number
    carbs_g: number
    bmr: number
    tdee: number
    adaptive: number
    effective_from: number
  }>('SELECT * FROM goals ORDER BY effective_from DESC, id DESC LIMIT 1')

  if (!row) return null
  return {
    goalType: row.goal_type as Goal,
    targetKcal: row.target_kcal,
    targetRawKcal: row.target_raw_kcal,
    floorApplied: row.floor_applied === 1,
    protein_g: row.protein_g,
    fat_g: row.fat_g,
    carbs_g: row.carbs_g,
    bmr: row.bmr,
    tdee: row.tdee,
    adaptive: row.adaptive === 1,
    effectiveFrom: row.effective_from,
  }
}

export async function setting(key: string, fallback = ''): Promise<string> {
  const h = await db()
  const row = await h.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
  return row?.value ?? fallback
}

export async function putSetting(key: string, value: string): Promise<void> {
  const h = await db()
  await h.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [key, value])
}

/** A consent the user gave, with when and to which version of the text. */
export async function recordConsent(key: string, detail: string): Promise<void> {
  const h = await db()
  await h.run('INSERT OR REPLACE INTO consents (key, granted, granted_at, detail) VALUES (?, 1, ?, ?)', [key, Date.now(), detail])
}

/** Manual target override from the plan screen's pencil icons. */
export async function overrideTargets(
  next: { targetKcal: number; macros: MacroTargets },
  base: CurrentGoal,
  now: number,
): Promise<void> {
  const h = await db()
  await h.run(
    `INSERT INTO goals
       (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
        floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      now,
      base.goalType,
      null,
      next.targetKcal,
      next.targetKcal,
      0,
      next.macros.protein_g,
      next.macros.fat_g,
      next.macros.carbs_g,
      base.bmr,
      base.tdee,
      // A hand-set target turns the adaptive loop OFF. Silently overwriting a
      // number the user deliberately chose is the fastest way to lose their
      // trust in every other number.
      0,
    ],
  )
}

export interface RecomputedGoal {
  target: CalorieTarget
  macros: MacroTargets
  goalType: Goal
  weightKg: number
  heightCm: number
  activity: ActivityLevel
}

/**
 * The plan onboarding would produce today: profile (sex, birth year, height,
 * activity) plus the LATEST weigh-in and the desired weight saved earlier. Same
 * rate rule as the plan screen. Returns null until there is a profile and a weight.
 * Age is computed from the full birth date when month and day are known (installs
 * that onboarded after schema v2, or re-did the birth date screen). Installs that
 * migrated from v1 and never revisited it fall back to a calendar-year difference,
 * which can be a year high before the birthday.
 */
/**
 * Age from a birth date. Falls back to the calendar-year difference when month
 * or day is unknown (pre-v2 installs that never revisited the birth date screen).
 */
function ageFromBirthDate(now: number, year: number, month: number | null, day: number | null): number {
  const today = new Date(now)
  const thisYearAge = today.getFullYear() - year
  if (month == null || day == null) return thisYearAge
  const hadBirthdayThisYear =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day)
  return hadBirthdayThisYear ? thisYearAge : thisYearAge - 1
}

export async function recomputeGoalFromProfile(
  now: number,
  activityOverride?: ActivityLevel,
): Promise<RecomputedGoal | null> {
  const h = await db()
  const p = await h.get<{
    sex: string | null
    birth_year: number | null
    birth_month: number | null
    birth_day: number | null
    height_cm: number | null
    activity_level: string | null
  }>('SELECT sex, birth_year, birth_month, birth_day, height_cm, activity_level FROM user_profile WHERE id = 1')
  const w = await h.get<{ weight_kg: number }>('SELECT weight_kg FROM weight_entries ORDER BY local_date DESC LIMIT 1')
  if (!p || !w || p.height_cm == null) return null

  const desiredRaw = Number.parseFloat(await setting('goal.desiredWeightKg', ''))
  const desiredKg = Number.isFinite(desiredRaw) && desiredRaw > 0 ? desiredRaw : w.weight_kg
  const goalType = inferredGoal({ weightKg: w.weight_kg, desiredWeightKg: desiredKg })
  const deltaLb = Math.abs(desiredKg - w.weight_kg) * LB_PER_KG
  const rate = goalType === 'maintain' ? 0 : Math.min(1, Math.max(0.25, deltaLb / 12))
  const age = p.birth_year == null ? 30 : Math.max(13, Math.min(100, ageFromBirthDate(now, p.birth_year, p.birth_month, p.birth_day)))

  const activity = activityOverride ?? ((p.activity_level ?? 'sedentary') as ActivityLevel)
  const target = computeCalorieTarget({
    sex: p.sex === 'male' || p.sex === 'female' ? p.sex : 'unspecified',
    weightKg: w.weight_kg,
    heightCm: p.height_cm,
    ageYears: age,
    activity,
    goal: goalType,
    rateLbPerWeek: rate,
  })
  const macros = computeMacros(target.target, w.weight_kg, goalType)
  return { target, macros, goalType, weightKg: w.weight_kg, heightCm: p.height_cm, activity }
}

/**
 * Save a recomputed plan: the activity level goes into the profile and the plan
 * becomes a new goals row. Adaptive goals come back ON.
 */
export async function applyRecomputedGoal(r: RecomputedGoal, now: number): Promise<void> {
  const h = await db()
  await h.transaction(async (tx) => {
    await tx.run('UPDATE user_profile SET activity_level = ? WHERE id = 1', [r.activity])
    await tx.run(
      `INSERT INTO goals
         (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
          floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        now,
        r.goalType,
        null,
        r.target.target,
        r.target.targetRaw,
        r.target.floorApplied ? 1 : 0,
        r.macros.protein_g,
        r.macros.fat_g,
        r.macros.carbs_g,
        r.target.bmr,
        r.target.tdee,
      ],
    )
  })
}

// ---------------------------------------------------------------------------
// Day totals
// ---------------------------------------------------------------------------

export interface DayTotals {
  kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  fiber_g: number
  sugar_g: number
  sodium_mg: number
  mealCount: number
  distinctSlots: number
  pendingCount: number
}

/**
 * Derived from log_items on every read, never stored.
 *
 * `day_summaries` exists as a cache for the widget, but it is droppable and
 * rebuildable — this query is the source of truth.
 */
export async function dayTotals(date: string): Promise<DayTotals> {
  const h = await db()

  const row = await h.get<{
    kcal: number | null
    p: number | null
    f: number | null
    c: number | null
    fi: number | null
    su: number | null
    so: number | null
    meals: number | null
    slots: number | null
  }>(
    `SELECT
       SUM(li.snap_energy_kcal * li.grams / 100.0 * m.portion_eaten_fraction) AS kcal,
       SUM(li.snap_protein_g   * li.grams / 100.0 * m.portion_eaten_fraction) AS p,
       SUM(li.snap_fat_g       * li.grams / 100.0 * m.portion_eaten_fraction) AS f,
       SUM(li.snap_carb_g      * li.grams / 100.0 * m.portion_eaten_fraction) AS c,
       SUM(li.snap_fiber_g     * li.grams / 100.0 * m.portion_eaten_fraction) AS fi,
       SUM(li.snap_sugar_g     * li.grams / 100.0 * m.portion_eaten_fraction) AS su,
       SUM(li.snap_sodium_mg   * li.grams / 100.0 * m.portion_eaten_fraction) AS so,
       COUNT(DISTINCT m.id)        AS meals,
       COUNT(DISTINCT m.meal_slot) AS slots
     FROM meals m
     JOIN log_items li ON li.meal_id = m.id
     WHERE m.local_date = ? AND m.analysis_status IN ('complete','manual')`,
    [date],
  )

  const pending = await h.get<{ c: number }>(
    `SELECT COUNT(*) c FROM meals
     WHERE local_date = ? AND analysis_status IN ('captured','queued','analyzing')`,
    [date],
  )

  return {
    kcal: row?.kcal ?? 0,
    protein_g: row?.p ?? 0,
    fat_g: row?.f ?? 0,
    carbs_g: row?.c ?? 0,
    // SUM ignores NULL snapshots, so an item without fiber/sugar/sodium data
    // counts as unknown rather than as zero of something else.
    fiber_g: row?.fi ?? 0,
    sugar_g: row?.su ?? 0,
    sodium_mg: row?.so ?? 0,
    mealCount: row?.meals ?? 0,
    distinctSlots: row?.slots ?? 0,
    // Pending scans contribute ZERO calories. A number that silently grows later
    // is worse than a number that is visibly incomplete.
    pendingCount: pending?.c ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Meals
// ---------------------------------------------------------------------------

export interface MealRow {
  id: number
  name: string
  kcal: number
  /** Local HH:MM. */
  time: string
  /** Still being analysed, so it contributes nothing to the totals yet. */
  pending: boolean
}

/** Meals of one day for the Today list, newest first. */
export async function mealsForDay(date: string): Promise<MealRow[]> {
  const h = await db()
  const rows = await h.all<{
    id: number
    logged_at: number
    analysis_status: string
    names: string | null
    kcal: number | null
  }>(
    `SELECT m.id, m.logged_at, m.analysis_status,
       (SELECT group_concat(display_name, ', ')
          FROM (SELECT display_name FROM log_items WHERE meal_id = m.id ORDER BY sort_order)) AS names,
       COALESCE((SELECT SUM(snap_energy_kcal * grams / 100.0) FROM log_items WHERE meal_id = m.id), 0)
         * m.portion_eaten_fraction AS kcal
     FROM meals m
     WHERE m.local_date = ? AND m.analysis_status IN ('complete','manual','captured','queued','analyzing')
     ORDER BY m.logged_at DESC, m.id DESC`,
    [date],
  )
  const pad = (n: number) => String(n).padStart(2, '0')
  return rows.map((r) => {
    const d = new Date(r.logged_at)
    const done = r.analysis_status === 'complete' || r.analysis_status === 'manual'
    return {
      id: r.id,
      name: r.names ?? 'Posiłek',
      kcal: r.kcal ?? 0,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      pending: !done,
    }
  })
}

/**
 * Remove a meal and its ingredients. Day totals are derived from log_items on
 * every read, so nothing else needs correcting. The cost ledger row stays: it is
 * a record of tokens already spent, not of what was eaten.
 */
export async function deleteMeal(id: number): Promise<void> {
  const h = await db()
  await h.transaction(async (tx) => {
    await tx.run('DELETE FROM log_items WHERE meal_id = ?', [id])
    await tx.run('DELETE FROM meals WHERE id = ?', [id])
  })
}

/**
 * Persist a reviewed scan. One transaction: the meal row, every ingredient with
 * its per-100 g snapshot copied in (never re-looked-up live), and the cost
 * ledger entry with REAL token counts. analysis_status lands as 'complete',
 * which is what dayTotals reads — logging is what makes the Today ring move.
 */
export async function logMeal(
  result: import('@nutai/pipeline').ScanResult,
  meta: {
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    costUsd: number
  } | null,
  photoUri: string | null,
  now: number,
): Promise<number> {
  const h = await db()
  const date = localDate(now)

  return h.transaction(async (tx) => {
    const meal = await tx.run(
      `INSERT INTO meals (logged_at, local_date, meal_slot, photo_uri, portion_eaten_fraction,
                          analysis_status, engine_id, prompt_version, schema_version,
                          clamp_flags_json, created_at)
       VALUES (?,?,?,?,?,'complete',?,?,?,?,?)`,
      [
        now,
        date,
        slotFor(now),
        photoUri,
        result.meal.portionEatenFraction,
        result.meal.engineId,
        result.meal.promptVersion,
        result.meal.schemaVersion,
        JSON.stringify(result.clampFlags ?? []),
        now,
      ],
    )
    const mealId = Number(meal.lastInsertRowId)

    let sort = 0
    for (const row of result.meal.ingredients) {
      const foodId = row.sourceFoodId == null ? null : Number(row.sourceFoodId)
      await tx.run(
        `INSERT INTO log_items (meal_id, matched_food_id, matched_food_source, raw_model_label,
                                display_name, grams, gram_pathway, portion_source,
                                snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g,
                                snap_fiber_g, snap_sugar_g, snap_sodium_mg,
                                is_estimate, macros_user_edited, band_half_pct,
                                assumptions_json, sort_order, logged_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          mealId,
          Number.isFinite(foodId as number) ? foodId : null,
          row.origin === 'web_lookup' ? 'web' : row.sourceFoodId != null ? 'corpus' : 'estimate',
          row.sourceUrl ?? null,
          row.displayName,
          row.grams,
          row.gramPathway,
          row.origin,
          row.nutrientSnapshot.kcal,
          row.nutrientSnapshot.protein_g,
          row.nutrientSnapshot.fat_g,
          row.nutrientSnapshot.carbs_g,
          row.nutrientSnapshot.fiber_g ?? null,
          row.nutrientSnapshot.sugar_g ?? null,
          row.nutrientSnapshot.sodium_mg ?? null,
          row.isEstimate ? 1 : 0,
          row.macrosUserEdited ? 1 : 0,
          row.bandHalfPct,
          JSON.stringify(row.assumptions ?? []),
          sort++,
          now,
        ],
      )
    }

    if (meta) {
      await tx.run(
        `INSERT INTO scan_cost_ledger (meal_id, provider, model, input_tokens, output_tokens,
                                       cost_usd, local_month, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [mealId, meta.provider, meta.model, meta.inputTokens, meta.outputTokens, meta.costUsd, date.slice(0, 7), now],
      )
    }

    return mealId
  })
}

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

export async function logWeight(kg: number, now: number): Promise<void> {
  const h = await db()
  await h.run(
    'INSERT OR REPLACE INTO weight_entries (local_date, weight_kg, logged_at) VALUES (?,?,?)',
    [localDate(now), kg, now],
  )
}

export async function weightHistory(): Promise<WeightPoint[]> {
  const h = await db()
  const rows = await h.all<{ local_date: string; weight_kg: number }>(
    'SELECT local_date, weight_kg FROM weight_entries ORDER BY local_date ASC',
  )
  return rows.map((r) => ({
    day: Math.floor(Date.parse(`${r.local_date}T00:00:00Z`) / 86_400_000),
    weightKg: r.weight_kg,
  }))
}

// ---------------------------------------------------------------------------
// The adaptive loop
// ---------------------------------------------------------------------------

export interface AdaptiveOutcome {
  ran: boolean
  reason: string
  previousKcal?: number
  newKcal?: number
  surfaced?: boolean
  explanation?: string
}

/**
 * Run the adaptive-TDEE estimator and, if it moved enough to matter, write a new
 * goals row.
 *
 * Three gates before it is allowed to change anything, each guarding a real
 * failure:
 *
 *   1. ENOUGH WEIGH-INS. A slope from two points is noise wearing a trend's
 *      clothes.
 *   2. ONLY COMPLETE DAYS feed the intake average. Admitting half-logged days
 *      biases intake downward, which inflates observed TDEE, which RAISES the
 *      target — a silent feedback loop that rewards under-logging.
 *   3. A >= 75 kcal MOVE before anything is surfaced. A target that shifts daily
 *      teaches people to ignore it.
 */
export async function runAdaptive(now: number): Promise<AdaptiveOutcome> {
  const goal = await currentGoal()
  if (!goal) return { ran: false, reason: 'Nie ustawiono jeszcze celu.' }
  if (!goal.adaptive) return { ran: false, reason: 'Cele adaptacyjne są wyłączone, ten cel ustawiono ręcznie.' }

  const points = await weightHistory()
  if (points.length < 5) {
    return { ran: false, reason: `Potrzeba jeszcze około ${5 - points.length} ${pluralPl(5 - points.length, 'ważenia', 'ważeń', 'ważeń')}, zanim trend cokolwiek znaczy.` }
  }

  const trend = computeTrend(points)
  const slope = trendSlopeLbPerWeek(trend)
  if (slope == null) return { ran: false, reason: 'Zbyt mała rozpiętość w czasie między ważeniami.' }

  const h = await db()
  const days = await h.all<{ local_date: string }>(
    'SELECT DISTINCT local_date FROM meals ORDER BY local_date DESC LIMIT 21',
  )

  let sum = 0
  let admitted = 0
  for (const d of days) {
    const t = await dayTotals(d.local_date)
    const complete = isDayCompleteEnough({
      mealCount: t.mealCount,
      distinctSlotCount: t.distinctSlots,
      hasQueuedEntries: t.pendingCount > 0,
    })
    if (!complete) continue
    sum += t.kcal
    admitted++
  }

  if (admitted < 5) {
    return { ran: false, reason: `Potrzeba jeszcze około ${5 - admitted} ${pluralPl(5 - admitted, 'dnia', 'dni', 'dni')} z pełnym zapisem posiłków, zanim cel zostanie dostosowany.` }
  }

  // At most one estimator step per local day. Without this every visit to the
  // Today screen counted as an update, and the 1/(n+k) gain shrank with app opens
  // instead of with real updates.
  const lastRunAt = Number(await setting('adaptive.lastRunAt', '0'))
  if (lastRunAt > 0 && localDate(lastRunAt) === localDate(now)) {
    return { ran: false, reason: 'Cel sprawdzono dziś, kolejne sprawdzenie jutro.' }
  }

  const updateCount = Number(await setting('adaptive.updateCount', '0'))
  // The estimator works on TDEE. Feeding it the calorie target (TDEE minus the
  // deficit) made every update drag the target toward maintenance.
  const result = updateAdaptiveTdee({
    currentTdee: goal.tdee,
    avgDailyIntakeKcal: sum / admitted,
    trendSlopeLbPerWeek: slope,
    updateCount,
  })
  await putSetting('adaptive.lastRunAt', String(now))

  const profile = await h.get<{ sex: string | null }>('SELECT sex FROM user_profile WHERE id = 1')
  const sex: Sex = profile?.sex === 'male' || profile?.sex === 'female' ? profile.sex : 'unspecified'
  const next = retargetFromTdee({
    priorTdee: goal.tdee,
    priorTarget: goal.targetKcal,
    newTdee: result.newTdee,
    floor: safeFloor(sex, goal.bmr),
  })

  if (!result.shouldSurface || Math.abs(next.target - goal.targetKcal) < 1) {
    return {
      ran: true,
      reason: 'Twój cel nadal jest trafny, nie ma zmiany wartej pokazania.',
      previousKcal: goal.targetKcal,
      newKcal: goal.targetKcal,
      surfaced: false,
    }
  }

  await putSetting('adaptive.updateCount', String(updateCount + 1))

  // Macros re-derive from the new target so protein tracks the body, not the
  // budget, and carbs stay the single derived remainder.
  const latestKg = points[points.length - 1]?.weightKg ?? 80
  const macros = computeMacros(next.target, latestKg, goal.goalType)

  await h.run(
    `INSERT INTO goals
       (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
        floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
    [
      now,
      goal.goalType,
      null,
      next.target,
      next.raw,
      next.floorApplied ? 1 : 0,
      macros.protein_g,
      macros.fat_g,
      macros.carbs_g,
      goal.bmr,
      result.newTdee,
    ],
  )

  return {
    ran: true,
    reason: 'Target updated.',
    previousKcal: goal.targetKcal,
    newKcal: next.target,
    surfaced: true,
    explanation: result.explanation,
  }
}
