import { describe, expect, it } from 'vitest'
import {
  computeBmr,
  ACTIVITY_MULTIPLIERS,
  bmi,
  computeCalorieTarget,
  computeMacros,
  computeTrend,
  isDayCompleteEnough,
  katchMcArdle,
  mifflinStJeor,
  retargetFromTdee,
  safeFloor,
  TARGET_CHANGE_THRESHOLD_KCAL,
  trendSlopeLbPerWeek,
  UNDERWEIGHT_BMI,
  updateAdaptiveTdee,
  type BodyInputs,
} from './index.js'

const body: BodyInputs = { sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30 }

describe('BMR', () => {
  it('applies Mifflin-St Jeor per sex', () => {
    // 10*80 + 6.25*180 - 5*30 = 800 + 1125 - 150 = 1775
    expect(mifflinStJeor(body)).toBeCloseTo(1780, 6)
    expect(mifflinStJeor({ ...body, sex: 'female' })).toBeCloseTo(1614, 6)
  })

  it('uses the averaged constant for unspecified, and it sits between the two', () => {
    const m = mifflinStJeor({ ...body, sex: 'male' })
    const f = mifflinStJeor({ ...body, sex: 'female' })
    const u = mifflinStJeor({ ...body, sex: 'unspecified' })
    expect(u).toBeGreaterThan(f)
    expect(u).toBeLessThan(m)
    expect(u).toBeCloseTo((m + f) / 2, 6)
  })

  it('refuses Katch-McArdle without a body-fat figure rather than inventing one', () => {
    expect(() => computeBmr(body, 'katch')).toThrow(/never inferred/)
  })

  it('computes Katch-McArdle from lean mass when body fat is supplied', () => {
    // 370 + 21.6 * (80 * 0.8) = 370 + 1382.4
    expect(katchMcArdle(80, 0.2)).toBeCloseTo(1752.4, 6)
  })
})

describe('the safety floor is a hard clamp that always explains itself', () => {
  it('fires on an aggressive deficit and reports the raw value it replaced', () => {
    const t = computeCalorieTarget({
      sex: 'female', weightKg: 55, heightCm: 160, ageYears: 30,
      activity: 'sedentary', goal: 'lose', rateLbPerWeek: 2,
    })
    expect(t.floorApplied).toBe(true)
    expect(t.target).toBeGreaterThan(t.targetRaw)
    expect(t.target).toBe(t.floor)
    expect(t.floorExplanation).toMatch(/wyniósłby/)
    expect(t.floorExplanation).toMatch(String(Math.round(t.targetRaw)))
  })

  it('does not fire on a reasonable deficit, and says nothing when it does not', () => {
    const t = computeCalorieTarget({
      ...body, activity: 'moderate', goal: 'lose', rateLbPerWeek: 1,
    })
    expect(t.floorApplied).toBe(false)
    expect(t.floorExplanation).toBeNull()
    expect(t.target).toBe(t.targetRaw)
  })

  it('never returns a target below the floor, for any input', () => {
    for (const rate of [0.5, 1, 1.5, 2, 3, 5]) {
      for (const sex of ['male', 'female', 'unspecified'] as const) {
        const t = computeCalorieTarget({
          ...body, sex, activity: 'sedentary', goal: 'lose', rateLbPerWeek: rate,
        })
        expect(t.target).toBeGreaterThanOrEqual(t.floor - 1e-9)
      }
    }
  })

  it('takes the higher of the flat floor and 1.2x BMR', () => {
    // A large person's 1.2x BMR exceeds the flat floor.
    const big = safeFloor('male', 2200)
    expect(big).toBeCloseTo(2640, 6)
    // A small person's flat floor exceeds 1.2x BMR.
    expect(safeFloor('female', 900)).toBe(1200)
  })

  it('warns rather than silently allowing an extreme rate', () => {
    const t = computeCalorieTarget({
      ...body, activity: 'sedentary', goal: 'lose', rateLbPerWeek: 3,
    })
    expect(t.warnings.length).toBeGreaterThan(0)
    expect(t.warnings.join(' ')).toMatch(/sustainable|bodyweight/)
  })
})

describe('TDEE', () => {
  it('scales by the activity multiplier', () => {
    const sed = computeCalorieTarget({ ...body, activity: 'sedentary', goal: 'maintain', rateLbPerWeek: 0 })
    const act = computeCalorieTarget({ ...body, activity: 'very_active', goal: 'maintain', rateLbPerWeek: 0 })
    expect(act.tdee / sed.tdee).toBeCloseTo(
      ACTIVITY_MULTIPLIERS.very_active / ACTIVITY_MULTIPLIERS.sedentary, 6,
    )
  })

  it('maintain applies no delta in either direction', () => {
    const t = computeCalorieTarget({ ...body, activity: 'moderate', goal: 'maintain', rateLbPerWeek: 1 })
    expect(t.targetRaw).toBeCloseTo(t.tdee, 6)
  })

  it('gain adds where lose subtracts', () => {
    const lose = computeCalorieTarget({ ...body, activity: 'moderate', goal: 'lose', rateLbPerWeek: 1 })
    const gain = computeCalorieTarget({ ...body, activity: 'moderate', goal: 'gain', rateLbPerWeek: 1 })
    expect(gain.targetRaw - lose.tdee).toBeCloseTo(lose.tdee - lose.targetRaw, 6)
  })
})

describe('macros — carbs are always the derived variable', () => {
  it('reconciles exactly back to the calorie target', () => {
    const m = computeMacros(2200, 80, 'lose')
    expect(4 * m.protein_g + 4 * m.carbs_g + 9 * m.fat_g).toBeCloseTo(2200, 6)
  })

  it('scales protein with bodyweight, not with the calorie budget', () => {
    const lowCal = computeMacros(1600, 80, 'lose')
    const highCal = computeMacros(2800, 80, 'lose')
    expect(lowCal.protein_g).toBeCloseTo(highCal.protein_g, 6)
  })

  it('honors the fat floor at low calorie targets', () => {
    const m = computeMacros(1300, 90, 'lose')
    expect(m.fat_g).toBeGreaterThanOrEqual(0.6 * 90 - 1e-9)
  })

  it('floors carbs at zero and flags it rather than showing a negative', () => {
    const m = computeMacros(900, 120, 'lose')
    expect(m.carbs_g).toBe(0)
    expect(m.carbsFloored).toBe(true)
  })
})

describe('BMI note', () => {
  it('computes BMI and identifies an underweight goal', () => {
    expect(bmi(70, 175)).toBeCloseTo(22.86, 2)
    expect(bmi(50, 175)).toBeLessThan(UNDERWEIGHT_BMI)
  })
})

describe('weight trend', () => {
  it('seeds the trend with the first real measurement', () => {
    const t = computeTrend([{ day: 0, weightKg: 80 }])
    expect(t[0]?.trendKg).toBe(80)
  })

  it('holds the previous trend across a missing day and never synthesizes a raw value', () => {
    const t = computeTrend([
      { day: 0, weightKg: 80 },
      { day: 3, weightKg: 79 },
    ])
    expect(t).toHaveLength(4)
    expect(t[1]?.rawKg).toBeNull()
    expect(t[2]?.rawKg).toBeNull()
    expect(t[1]?.trendKg).toBe(80)
    expect(t[2]?.trendKg).toBe(80)
    expect(t[3]?.rawKg).toBe(79)
  })

  it('barely moves for a single water-weight spike', () => {
    const steady = Array.from({ length: 20 }, (_, i) => ({ day: i, weightKg: 80 }))
    const withSpike = [...steady]
    withSpike[10] = { day: 10, weightKg: 81.4 } // ~3 lb overnight jump

    const a = computeTrend(steady).at(-1)!.trendKg
    const b = computeTrend(withSpike).at(-1)!.trendKg
    // A 1.4 kg raw spike must not move the trend by anything like 1.4 kg.
    expect(Math.abs(b - a)).toBeLessThan(0.2)
  })

  it('recovers a steady downward slope', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ day: i, weightKg: 90 - i * 0.05 }))
    const slope = trendSlopeLbPerWeek(computeTrend(pts))
    expect(slope).not.toBeNull()
    // 0.05 kg/day = 0.35 kg/week ~= 0.77 lb/week, losing.
    expect(slope!).toBeLessThan(0)
    expect(Math.abs(slope!)).toBeGreaterThan(0.4)
  })

  it('returns null rather than a fake slope with too little data', () => {
    expect(trendSlopeLbPerWeek(computeTrend([{ day: 0, weightKg: 80 }]))).toBeNull()
    expect(trendSlopeLbPerWeek([])).toBeNull()
  })
})

describe('adaptive TDEE', () => {
  it('raises the estimate when someone loses faster than their intake implies', () => {
    const r = updateAdaptiveTdee({
      currentTdee: 2500, avgDailyIntakeKcal: 2000, trendSlopeLbPerWeek: -1.5, updateCount: 0,
    })
    // Losing 1.5 lb/wk on 2000 kcal implies expenditure ~2750.
    expect(r.observedTdee).toBeCloseTo(2000 + (1.5 * 3500) / 7, 6)
    expect(r.newTdee).toBeGreaterThan(2500)
  })

  it('lowers the estimate when weight holds despite a nominal deficit', () => {
    const r = updateAdaptiveTdee({
      currentTdee: 2500, avgDailyIntakeKcal: 2000, trendSlopeLbPerWeek: 0, updateCount: 0,
    })
    expect(r.observedTdee).toBe(2000)
    expect(r.newTdee).toBeLessThan(2500)
  })

  it('adapts more slowly as evidence accumulates', () => {
    const early = updateAdaptiveTdee({
      currentTdee: 2500, avgDailyIntakeKcal: 2000, trendSlopeLbPerWeek: 0, updateCount: 0,
    })
    const late = updateAdaptiveTdee({
      currentTdee: 2500, avgDailyIntakeKcal: 2000, trendSlopeLbPerWeek: 0, updateCount: 40,
    })
    expect(Math.abs(late.newTdee - 2500)).toBeLessThan(Math.abs(early.newTdee - 2500))
  })

  it('does not surface a change below the whiplash threshold', () => {
    const r = updateAdaptiveTdee({
      currentTdee: 2500, avgDailyIntakeKcal: 2490, trendSlopeLbPerWeek: 0, updateCount: 10,
    })
    expect(Math.abs(r.newTdee - 2500)).toBeLessThan(TARGET_CHANGE_THRESHOLD_KCAL)
    expect(r.shouldSurface).toBe(false)
  })

  it('always explains what it observed in plain language', () => {
    const r = updateAdaptiveTdee({
      currentTdee: 2500, avgDailyIntakeKcal: 2000, trendSlopeLbPerWeek: -1.5, updateCount: 0,
    })
    expect(r.explanation).toMatch(/spada/)
    expect(r.explanation).toMatch(/2000 kcal/)
  })
})

describe('day completeness gate', () => {
  it('admits a day with meals across two slots and nothing queued', () => {
    expect(isDayCompleteEnough({ mealCount: 2, distinctSlotCount: 2, hasQueuedEntries: false })).toBe(true)
  })

  it('rejects a single-slot day, which would bias intake downward', () => {
    expect(isDayCompleteEnough({ mealCount: 3, distinctSlotCount: 1, hasQueuedEntries: false })).toBe(false)
  })

  it('rejects a day with a pending scan, whose calories are not counted yet', () => {
    expect(isDayCompleteEnough({ mealCount: 3, distinctSlotCount: 3, hasQueuedEntries: true })).toBe(false)
  })
})

describe('retargetFromTdee keeps the chosen deficit', () => {
  it('moves the target with the TDEE estimate and keeps the gap', () => {
    const r = retargetFromTdee({ priorTdee: 2500, priorTarget: 2000, newTdee: 2600, floor: 1500 })
    expect(r.target).toBeCloseTo(2100, 6)
    expect(r.floorApplied).toBe(false)
  })

  it('still respects the safe floor', () => {
    const r = retargetFromTdee({ priorTdee: 1700, priorTarget: 1300, newTdee: 1400, floor: 1200 })
    expect(r.raw).toBeCloseTo(1000, 6)
    expect(r.target).toBe(1200)
    expect(r.floorApplied).toBe(true)
  })

  it('clamps a gap an older version of the loop could have left behind', () => {
    const r = retargetFromTdee({ priorTdee: 2500, priorTarget: 1200, newTdee: 2500, floor: 1200 })
    expect(r.raw).toBeCloseTo(1500, 6)
  })
})
