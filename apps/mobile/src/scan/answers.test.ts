import { describe, expect, it } from 'vitest'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import { applyAnswer, isAnswerable, revert, undoRowId } from './answers'

function row(over: Partial<IngredientRow> = {}): IngredientRow {
  return {
    id: 'r1',
    displayName: 'Makaron',
    sourceFoodId: '1',
    grams: 200,
    nutrientSnapshot: { kcal: 130, protein_g: 5, fat_g: 1, carbs_g: 25, fiber_g: 1, sugar_g: 1, sodium_mg: 5 },
    origin: 'vision_model',
    gramPathway: 'model_guess',
    bandHalfPct: 0.2,
    isEstimate: false,
    assumptions: [],
    ...over,
  }
}

function meal(rows: IngredientRow[], portion = 1): LoggedMeal {
  return {
    id: 'm',
    loggedAt: '2026-10-28T12:00:00Z',
    ingredients: rows,
    portionEatenFraction: portion,
    engineId: 't',
    promptVersion: null,
    schemaVersion: null,
    clampFlags: [],
  }
}

const sauce = () => row({ id: 'r2', displayName: 'Sos pomidorowy', grams: 60 })
const oil = (g = 14) => row({ id: 'item-0-oil', displayName: 'Olej do smażenia', grams: g, origin: 'assumption_filler' })

describe('isAnswerable', () => {
  it('hides unwired questions and sauce without a sauce row', () => {
    const m = meal([row()])
    expect(isAnswerable('portion_eaten', m)).toBe(true)
    expect(isAnswerable('cooking_oil', m)).toBe(true)
    expect(isAnswerable('sauce_type', m)).toBe(false)
    expect(isAnswerable('milk_type', m)).toBe(false)
    expect(isAnswerable('sauce_type', meal([row(), sauce()]))).toBe(true)
  })
})

describe('portion_eaten', () => {
  it('applies and reverts to the original fraction', () => {
    const m = meal([row()])
    const a = applyAnswer(m, 'portion_eaten', '0.5')!
    expect(a.meal.portionEatenFraction).toBe(0.5)
    expect(revert(a.meal, a.state.undo).portionEatenFraction).toBe(1)
  })

  it('switching chips keeps the original undo', () => {
    const m = meal([row()])
    const a = applyAnswer(m, 'portion_eaten', '0.5')!
    const b = applyAnswer(a.meal, 'portion_eaten', '0.25', a.state)!
    expect(b.meal.portionEatenFraction).toBe(0.25)
    expect(revert(b.meal, b.state.undo).portionEatenFraction).toBe(1)
  })
})

describe('sauce_type', () => {
  it('scales from the original grams and does not compound', () => {
    const m = meal([row(), sauce()])
    const light = applyAnswer(m, 'sauce_type', 'light')!
    expect(light.meal.ingredients[1]!.grams).toBe(30)
    const heavy = applyAnswer(light.meal, 'sauce_type', 'heavy', light.state)!
    expect(heavy.meal.ingredients[1]!.grams).toBe(120)
    expect(revert(heavy.meal, heavy.state.undo).ingredients[1]!.grams).toBe(60)
  })

  it('returns null when there is nothing to scale', () => {
    expect(applyAnswer(meal([row()]), 'sauce_type', 'heavy')).toBeNull()
  })
})

describe('cooking_oil', () => {
  it('none removes the oil row and revert restores it at its index', () => {
    const m = meal([row(), oil(), row({ id: 'r3', displayName: 'Ryż' })])
    const a = applyAnswer(m, 'cooking_oil', 'none')!
    expect(a.meal.ingredients.map((r) => r.id)).toEqual(['r1', 'r3'])
    expect(revert(a.meal, a.state.undo).ingredients.map((r) => r.id)).toEqual(['r1', 'item-0-oil', 'r3'])
  })

  it('little and lots set grams on an existing row and revert to the estimate', () => {
    const m = meal([row(), oil(14)])
    const lots = applyAnswer(m, 'cooking_oil', 'lots')!
    expect(lots.meal.ingredients[1]!.grams).toBe(28)
    expect(revert(lots.meal, lots.state.undo).ingredients[1]!.grams).toBe(14)
  })

  it('adds an oil row when there was none and revert removes it', () => {
    const m = meal([row()])
    const a = applyAnswer(m, 'cooking_oil', 'little')!
    expect(a.meal.ingredients).toHaveLength(2)
    expect(a.meal.ingredients[1]!.nutrientSnapshot.fat_g).toBe(100)
    expect(revert(a.meal, a.state.undo).ingredients).toHaveLength(1)
  })

  it('none then lots then revert ends at the original row', () => {
    const m = meal([row(), oil(14)])
    const none = applyAnswer(m, 'cooking_oil', 'none')!
    const lots = applyAnswer(none.meal, 'cooking_oil', 'lots', none.state)!
    expect(lots.meal.ingredients[1]!.grams).toBe(28)
    expect(revert(lots.meal, lots.state.undo).ingredients[1]!.grams).toBe(14)
    expect(undoRowId(lots.state.undo)).toBe('item-0-oil')
  })
})
