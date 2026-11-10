import { beforeEach, describe, expect, it } from 'vitest'
import type { Band } from '@nutai/confidence'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import { recomputeAfterEdit } from '@nutai/pipeline'
import type { ScanResult } from '@nutai/pipeline'
import {
  answerQuestion,
  replaceRowFood,
  setNote,
  setTitle,
  editGrams,
  getPhase,
  removeRow,
  reset,
  selectedAnswer,
  setPhase,
  setPortionEaten,
} from './store'

/**
 * The scan store's arithmetic — the numbers the user actually edits.
 *
 * Every mutation must recompute locally and keep the invariant that displayed
 * calories are reproducible from displayed macros.
 */

function row(over: Partial<IngredientRow> = {}): IngredientRow {
  return {
    id: 'r1',
    displayName: 'Grilled chicken breast',
    sourceFoodId: '1',
    grams: 170,
    nutrientSnapshot: { kcal: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 74 },
    origin: 'vision_model',
    gramPathway: 'fndds_standard_portion' as IngredientRow['gramPathway'],
    bandHalfPct: 0.2,
    isEstimate: false,
    assumptions: [],
    ...over,
  }
}

function readyWith(rows: IngredientRow[]): void {
  const meal: LoggedMeal = {
    id: 'm1',
    loggedAt: '2026-08-01T12:00:00Z',
    ingredients: rows,
    portionEatenFraction: 1,
    engineId: 'test',
    promptVersion: null,
    schemaVersion: null,
    clampFlags: [],
  }
  const bands: Band[] = rows.map((r) => ({ halfPct: r.bandHalfPct, tier: 'moderate', reasons: [] }))
  const { totals, mealBand } = recomputeAfterEdit(meal, bands)
  const result: ScanResult = {
    isFood: true,
    refusalReason: null,
    items: rows.map((r, i) => ({ row: r, band: bands[i]!, resolution: 'auto_accept', gramPathway: r.gramPathway })),
    meal,
    totals,
    mealBand,
    questions: [],
    clampFlags: [],
    zeroHitCount: 0,
  }
  setPhase({ kind: 'ready', photoUri: null, result, bands, meta: null })
}

const readyPhase = () => {
  const p = getPhase()
  if (p.kind !== 'ready') throw new Error(`expected ready, got ${p.kind}`)
  return p
}

beforeEach(() => reset())

describe('editGrams', () => {
  it('scales totals linearly and instantly', () => {
    readyWith([row()])
    const before = readyPhase().result.totals.kcal
    editGrams('r1', 340)
    const after = readyPhase().result.totals.kcal
    expect(after).toBeGreaterThan(before * 1.8)
    expect(after).toBeLessThan(before * 2.2)
  })

  it('ignores garbage input rather than corrupting the row', () => {
    readyWith([row()])
    const before = readyPhase().result.totals.kcal
    editGrams('r1', Number.NaN)
    editGrams('r1', -50)
    expect(readyPhase().result.totals.kcal).toBe(before)
  })
})

describe('removeRow', () => {
  it('drops the row and its contribution', () => {
    readyWith([row(), row({ id: 'r2', displayName: 'Rice', nutrientSnapshot: { kcal: 130, protein_g: 2.7, fat_g: 0.3, carbs_g: 28, fiber_g: 0, sugar_g: 0, sodium_mg: 1 }, grams: 180 })])
    removeRow('r2')
    const p = readyPhase()
    expect(p.result.meal.ingredients).toHaveLength(1)
    expect(p.result.totals.kcal).toBeLessThan(300)
  })
})

describe('setPortionEaten', () => {
  it('applies as a final multiplier and clamps to [0,1]', () => {
    readyWith([row()])
    const full = readyPhase().result.totals.kcal
    setPortionEaten(0.5)
    const half = readyPhase().result.totals.kcal
    expect(half).toBeGreaterThan(full * 0.4)
    expect(half).toBeLessThan(full * 0.6)

    setPortionEaten(7)
    expect(readyPhase().result.meal.portionEatenFraction).toBe(1)
  })
})

describe('a failed phase', () => {
  it('carries its short code through setPhase/getPhase', () => {
    setPhase({ kind: 'failed', photoUri: 'p', message: 'Dostawca ogranicza liczbę zapytań.', canRetry: true, failureKind: 'error-retryable', code: '429' })
    const p = getPhase()
    expect(p.kind).toBe('failed')
    if (p.kind === 'failed') expect(p.code).toBe('429')
  })
})

describe('answerQuestion', () => {
  const q = (id: string) =>
    ({ question: { id }, text: '', expectedValue: 0, state: 'highlighted', appliedDefault: null, disclosure: '' }) as never

  it('selects, switches and deselects back to the original estimate', () => {
    readyWith([row()])
    const full = readyPhase().result.totals.kcal
    answerQuestion(q('portion_eaten'), '0.5')
    expect(selectedAnswer(readyPhase(), 'portion_eaten')).toBe('0.5')
    expect(readyPhase().result.totals.kcal).toBeLessThan(full * 0.6)
    expect(readyPhase().result.totals.kcal).toBeGreaterThan(full * 0.4)
    answerQuestion(q('portion_eaten'), '0.25')
    expect(selectedAnswer(readyPhase(), 'portion_eaten')).toBe('0.25')
    answerQuestion(q('portion_eaten'), '0.25')
    expect(selectedAnswer(readyPhase(), 'portion_eaten')).toBeNull()
    expect(readyPhase().result.totals.kcal).toBe(full)
  })

  it('a manual gram edit drops the chip that scaled that row', () => {
    readyWith([row(), row({ id: 'r2', displayName: 'Sos czosnkowy', grams: 50 })])
    answerQuestion(q('sauce_type'), 'heavy')
    expect(selectedAnswer(readyPhase(), 'sauce_type')).toBe('heavy')
    editGrams('r2', 70)
    expect(selectedAnswer(readyPhase(), 'sauce_type')).toBeNull()
    expect(readyPhase().result.meal.ingredients[1]!.grams).toBe(70)
  })
})

describe('replaceRowFood and note', () => {
  it('swaps the nutrition, keeps the grams and marks the row exact', () => {
    readyWith([row({ origin: 'vision_model', isEstimate: true })])
    replaceRowFood('r1', {
      foodId: 7,
      displayName: 'Lu Petitki',
      nutrientSnapshot: { kcal: 450, protein_g: 7, fat_g: 12, carbs_g: 75, fiber_g: 2, sugar_g: 20, sodium_mg: 300 },
    })
    const r = readyPhase().result.meal.ingredients[0]!
    expect(r.displayName).toBe('Lu Petitki')
    expect(r.grams).toBe(170)
    expect(r.origin).toBe('manual_custom')
    expect(r.isEstimate).toBe(false)
    expect(readyPhase().result.totals.kcal).toBeGreaterThan(700)
  })

  it('keeps the description on the ready phase', () => {
    readyWith([row()])
    setNote('po treningu')
    expect(readyPhase().note).toBe('po treningu')
  })
})
