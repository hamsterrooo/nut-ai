import { describe, expect, it } from 'vitest'
import type { IngredientRow } from '@nutai/core-schema'
import { isPreciseMeal } from './precision'

const row = (origin: IngredientRow['origin']): IngredientRow => ({
  id: origin,
  displayName: origin,
  sourceFoodId: null,
  grams: 100,
  nutrientSnapshot: { kcal: 1, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
  origin,
  gramPathway: 'model_guess',
  bandHalfPct: 0.1,
  isEstimate: false,
  assumptions: [],
})

describe('isPreciseMeal', () => {
  it('is true for barcode, label, web and hand-picked rows', () => {
    expect(isPreciseMeal([row('barcode')])).toBe(true)
    expect(isPreciseMeal([row('label_ocr'), row('manual_custom')])).toBe(true)
  })
  it('is false when any row is a photo estimate, or the meal is empty', () => {
    expect(isPreciseMeal([row('barcode'), row('vision_model')])).toBe(false)
    expect(isPreciseMeal([row('db_search')])).toBe(false)
    expect(isPreciseMeal([])).toBe(false)
  })
})
