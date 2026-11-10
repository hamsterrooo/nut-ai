import { pluralPl } from '../i18n/format'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import {
  ageFromBirthDate,
  computeMacros,
  computeTrend,
  isDayCompleteEnough,
  planFor,
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
import { EXPORT_TABLES, WIPE_ONLY_TABLES } from './backup-core'
import { localDate } from './date-utils'
import { insertGoal } from './goal-write'
import { insertLogItem, insertMeal } from './log-write'
import { dissolveIfAlone } from './meal-edit'
import { clearCredential } from '../inference/credentials'
import { openUserDb } from '../db/expo-adapter'

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
 * and clears the completion flag. The bundled nutrition corpus is left alone — it is
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

/** Manual target override from the plan screen's pencil icons. */
export async function overrideTargets(
  next: { targetKcal: number; macros: MacroTargets },
  base: CurrentGoal,
  now: number,
): Promise<void> {
  await insertGoal(await db(), {
    effectiveFrom: now,
    goalType: base.goalType,
    targetKcal: next.targetKcal,
    targetRawKcal: next.targetKcal,
    floorApplied: false,
    ...next.macros,
    bmr: base.bmr,
    tdee: base.tdee,
    // A hand-set target turns the adaptive loop OFF. Silently overwriting a
    // number the user deliberately chose is the fastest way to lose their
    // trust in every other number.
    adaptive: false,
  })
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
 * The plan onboarding would produce today: profile (sex, birth date, height,
 * activity) plus the LATEST weigh-in and the desired weight saved earlier.
 * Returns null until there is a profile and a weight.
 */
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
  const activity = activityOverride ?? ((p.activity_level ?? 'sedentary') as ActivityLevel)
  const plan = planFor({
    sex: p.sex === 'male' || p.sex === 'female' ? p.sex : 'unspecified',
    weightKg: w.weight_kg,
    heightCm: p.height_cm,
    ageYears: ageFromBirthDate(now, p.birth_year, p.birth_month, p.birth_day),
    activity,
    desiredWeightKg: Number.isFinite(desiredRaw) && desiredRaw > 0 ? desiredRaw : w.weight_kg,
  })
  return { target: plan.target, macros: plan.macros, goalType: plan.goal, weightKg: w.weight_kg, heightCm: p.height_cm, activity }
}

/**
 * Save a recomputed plan: the activity level goes into the profile and the plan
 * becomes a new goals row. Adaptive goals come back ON.
 */
export async function applyRecomputedGoal(r: RecomputedGoal, now: number): Promise<void> {
  const h = await db()
  await h.transaction(async (tx) => {
    await tx.run('UPDATE user_profile SET activity_level = ? WHERE id = 1', [r.activity])
    await insertGoal(tx, {
      effectiveFrom: now,
      goalType: r.goalType,
      targetKcal: r.target.target,
      targetRawKcal: r.target.targetRaw,
      floorApplied: r.target.floorApplied,
      ...r.macros,
      bmr: r.target.bmr,
      tdee: r.target.tdee,
      adaptive: true,
    })
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
  /** Set when the user grouped this meal with others; the same value for every member. */
  groupId: number | null
  /** The user's title, else the ingredient names. */
  name: string
  note: string | null
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  /** Local HH:MM. */
  time: string
  /** Still being analysed, so it contributes nothing to the totals yet. */
  pending: boolean
  /**
   * Every ingredient came from a barcode, a label or the product database, not from
   * a photo estimate. Precise meals are shown to 0.1; photo estimates are rounded.
   */
  precise: boolean
}

/** Meals of one day for the Today list, newest first. */
export async function mealsForDay(date: string): Promise<MealRow[]> {
  const h = await db()
  const rows = await h.all<{
    id: number
    group_id: number | null
    logged_at: number
    analysis_status: string
    title: string | null
    note: string | null
    names: string | null
    kcal: number | null
    p: number | null
    c: number | null
    f: number | null
    estimates: number | null
  }>(
    `SELECT m.id, m.group_id, m.logged_at, m.analysis_status, m.title, m.note,
       (SELECT group_concat(display_name, ', ')
          FROM (SELECT display_name FROM log_items WHERE meal_id = m.id ORDER BY sort_order)) AS names,
       COALESCE((SELECT SUM(snap_energy_kcal * grams / 100.0) FROM log_items WHERE meal_id = m.id), 0)
         * m.portion_eaten_fraction AS kcal,
       COALESCE((SELECT SUM(snap_protein_g * grams / 100.0) FROM log_items WHERE meal_id = m.id), 0)
         * m.portion_eaten_fraction AS p,
       COALESCE((SELECT SUM(snap_carb_g * grams / 100.0) FROM log_items WHERE meal_id = m.id), 0)
         * m.portion_eaten_fraction AS c,
       COALESCE((SELECT SUM(snap_fat_g * grams / 100.0) FROM log_items WHERE meal_id = m.id), 0)
         * m.portion_eaten_fraction AS f,
       -- A photo estimate: the model's own guess, or a database row the model's label
       -- was matched to. Rows picked directly from the product database (meals with no
       -- engine_id), barcodes and labels are exact.
       (SELECT COUNT(*) FROM log_items WHERE meal_id = m.id
          AND (portion_source = 'vision_model' OR (portion_source = 'db_search' AND m.engine_id IS NOT NULL))) AS estimates
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
      groupId: r.group_id,
      name: r.title?.trim() || r.names || 'Posiłek',
      note: r.note,
      kcal: r.kcal ?? 0,
      protein_g: r.p ?? 0,
      carbs_g: r.c ?? 0,
      fat_g: r.f ?? 0,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      pending: !done,
      precise: done && (r.estimates ?? 0) === 0,
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
    const m = await tx.get<{ group_id: number | null }>('SELECT group_id FROM meals WHERE id = ?', [id])
    await tx.run('DELETE FROM log_items WHERE meal_id = ?', [id])
    await tx.run('DELETE FROM meals WHERE id = ?', [id])
    // A group of one is just a meal. If the group id was the deleted meal's own id,
    // the survivors keep it: the id only has to be shared, not point at a live row.
    if (m?.group_id != null) await dissolveIfAlone(tx, m.group_id)
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
  extras: { title?: string; note?: string } = {},
): Promise<number> {
  const h = await db()
  const date = localDate(now)

  return h.transaction(async (tx) => {
    const mealId = await insertMeal(tx, {
      loggedAt: now,
      photoUri,
      portionEatenFraction: result.meal.portionEatenFraction,
      engineId: result.meal.engineId,
      promptVersion: result.meal.promptVersion,
      schemaVersion: result.meal.schemaVersion,
      clampFlagsJson: JSON.stringify(result.clampFlags ?? []),
      title: extras.title?.trim() || null,
      note: extras.note?.trim() || null,
    })

    for (const [sort, row] of result.meal.ingredients.entries()) {
      const foodId = row.sourceFoodId == null ? null : Number(row.sourceFoodId)
      await insertLogItem(
        tx,
        mealId,
        {
          foodId: Number.isFinite(foodId as number) ? foodId : null,
          displayName: row.displayName,
          grams: row.grams,
          gramPathway: row.gramPathway,
          portionSource: row.origin,
          kcal: row.nutrientSnapshot.kcal,
          protein_g: row.nutrientSnapshot.protein_g,
          fat_g: row.nutrientSnapshot.fat_g,
          carbs_g: row.nutrientSnapshot.carbs_g,
          fiber_g: row.nutrientSnapshot.fiber_g ?? null,
          sugar_g: row.nutrientSnapshot.sugar_g ?? null,
          sodium_mg: row.nutrientSnapshot.sodium_mg ?? null,
          isEstimate: row.isEstimate,
          macrosUserEdited: row.macrosUserEdited ?? false,
          bandHalfPct: row.bandHalfPct,
          assumptionsJson: JSON.stringify(row.assumptions ?? []),
        },
        sort,
        now,
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

  await insertGoal(h, {
    effectiveFrom: now,
    goalType: goal.goalType,
    targetKcal: next.target,
    targetRawKcal: next.raw,
    floorApplied: next.floorApplied,
    ...macros,
    bmr: goal.bmr,
    tdee: result.newTdee,
    adaptive: true,
  })

  return {
    ran: true,
    reason: 'Target updated.',
    previousKcal: goal.targetKcal,
    newKcal: next.target,
    surfaced: true,
    explanation: result.explanation,
  }
}
