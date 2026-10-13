import { describe, expect, it } from 'vitest'
import type { IngredientRow, Item } from '@nutai/core-schema'
import {
  bandTier,
  classifyCategory,
  computeBand,
  MAX_DISPLAYED_HALF_PCT,
  mealBand,
  rangeFor,
  SEEDED_BASELINES,
  TIER_GLYPH,
  type Band,
} from './index.js'

function item(over: Partial<Item> = {}): Item {
  return {
    name: 'Grilled chicken breast',
    brand: null,
    canonical_food_key: 'chicken breast, grilled',
    food_form: 'flat',
    qualitative_size: 'medium',
    weight_basis: 'cooked',
    model_gram_estimate: 170,
    identification_confidence: 0.9,
    portion_confidence: 0.6,
    uncertainty_reason: 'none',
    visible_reference_objects: [],
    container: null,
    cooking_method_cues: ['grill_marks'],
    is_beverage: false,
    beverage_category: null,
    legible_label_text: null,
    stated_assumptions: [],
    clarifying_questions: [],
    fallback_macros_at_estimate: {
      calories_kcal: 280, protein_g: 53, carbs_g: 0, fat_g: 6, fiber_g: 0, sodium_mg: 130,
    },
    ...over,
  }
}

function row(over: Partial<IngredientRow> = {}): IngredientRow {
  return {
    id: 'r1',
    displayName: 'Chicken breast',
    sourceFoodId: '171077',
    grams: 170,
    nutrientSnapshot: { kcal: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0 },
    origin: 'vision_model',
    gramPathway: 'model_guess',
    bandHalfPct: 0.375,
    isEstimate: false,
    assumptions: [],
    ...over,
  }
}

const base = { baselines: SEEDED_BASELINES, path: 'cloud' as const }

describe('the model self-report is a modifier, never the signal', () => {
  it('does not let high model confidence override a weak pathway', () => {
    const b = computeBand({ ...base, row: row({ gramPathway: 'model_guess' }), item: item({ portion_confidence: 0.99 }) })
    // 0.375 * 0.85 = 0.319. Still clearly a wide band despite the model's 0.99.
    expect(b.halfPct).toBeGreaterThan(0.25)
  })

  it('widens when the model admits it is unsure, and says so in words', () => {
    const sure = computeBand({ ...base, row: row(), item: item({ portion_confidence: 0.9 }) })
    const unsure = computeBand({ ...base, row: row(), item: item({ portion_confidence: 0.2 }) })
    expect(unsure.halfPct).toBeGreaterThan(sure.halfPct)
    expect(unsure.reasons.join(' ')).toMatch(/nie jest pewien/)
  })

  it('gives a labeled packaged item a genuinely tight band', () => {
    const b = computeBand({
      ...base,
      row: row({ gramPathway: 'packaged_exact' }),
      item: item({ legible_label_text: 'Serving size 45g', portion_confidence: 0.95 }),
    })
    expect(b.halfPct).toBeLessThan(0.05)
    expect(b.tier).toBe('none')
  })
})

describe('structural widening', () => {
  it('widens a mixed composite dish above its pathway baseline', () => {
    const simple = computeBand({ ...base, row: row(), item: item() })
    const mixed = computeBand({
      ...base, row: row(), item: item({ canonical_food_key: 'chicken stir fry with vegetables' }),
    })
    expect(mixed.halfPct).toBeGreaterThan(simple.halfPct)
    expect(mixed.reasons.join(' ')).toMatch(/Dania mieszane/)
  })

  it('widens ground meat for the 62-77% yield spread', () => {
    const plain = computeBand({ ...base, row: row(), item: item() })
    const ground = computeBand({
      ...base, row: row(), item: item({ canonical_food_key: 'ground beef, pan fried' }),
    })
    expect(ground.halfPct).toBeGreaterThan(plain.halfPct)
    expect(ground.reasons.join(' ')).toMatch(/62-77%/)
  })

  it('widens a poured drink for unknown ABV', () => {
    const b = computeBand({
      ...base, row: row(),
      item: item({ is_beverage: true, beverage_category: 'alcoholic_poured_or_mixed', canonical_food_key: 'beer' }),
    })
    expect(b.reasons.join(' ')).toMatch(/Zawartości alkoholu/)
  })

  it('widens fried food for oil absorption', () => {
    const b = computeBand({
      ...base, row: row(), item: item({ cooking_method_cues: ['deep_fried_color'] }),
    })
    expect(b.reasons.join(' ')).toMatch(/wchłania/)
  })

  it('widens on the local path, because a closed vocabulary is a real constraint', () => {
    const cloud = computeBand({ ...base, row: row(), item: item() })
    const local = computeBand({ ...base, path: 'local', row: row(), item: item() })
    expect(local.halfPct).toBeGreaterThan(cloud.halfPct)
  })
})

describe('narrowing is earned, not assumed', () => {
  it('narrows only for a consistent personal prior with enough samples', () => {
    const noPrior = computeBand({ ...base, row: row(), item: item() })
    const consistent = computeBand({
      ...base, row: row(), item: item(), priorSampleCount: 8, priorRatioVariance: 0.01,
    })
    const noisy = computeBand({
      ...base, row: row(), item: item(), priorSampleCount: 8, priorRatioVariance: 0.3,
    })
    const tooFew = computeBand({
      ...base, row: row(), item: item(), priorSampleCount: 3, priorRatioVariance: 0.01,
    })
    expect(consistent.halfPct).toBeLessThan(noPrior.halfPct)
    expect(noisy.halfPct).toBe(noPrior.halfPct)
    expect(tooFew.halfPct).toBe(noPrior.halfPct)
  })

  it('narrows when a second opinion agrees and widens when it disagrees', () => {
    const agree = computeBand({
      ...base, row: row({ grams: 170 }), item: item(),
      secondOpinion: { gramsFor: () => 175 },
    })
    const disagree = computeBand({
      ...base, row: row({ grams: 170 }), item: item(),
      secondOpinion: { gramsFor: () => 300 },
    })
    expect(agree.halfPct).toBeLessThan(disagree.halfPct)
    expect(agree.reasons.join(' ')).toMatch(/zgodziły się/)
    expect(disagree.reasons.join(' ')).toMatch(/nie zgodziły się/)
  })
})

describe('clamp flags floor the band and never narrow it', () => {
  it('floors at 50% even when everything else says the estimate is tight', () => {
    const b = computeBand({
      ...base,
      row: row({ gramPathway: 'packaged_exact' }),
      item: item({ portion_confidence: 0.99, legible_label_text: 'x' }),
      hadClampFlag: true,
    })
    expect(b.halfPct).toBeGreaterThanOrEqual(0.5)
    expect(b.reasons.join(' ')).toMatch(/sprawdź go/)
  })

  it('never displays a band wider than the cap', () => {
    const b = computeBand({
      ...base, path: 'local',
      row: row({ gramPathway: 'clamped' }),
      item: item({
        canonical_food_key: 'ground beef stir fry',
        portion_confidence: 0.05,
        cooking_method_cues: ['deep_fried_color'],
        is_beverage: true,
        beverage_category: 'blended_shake_or_smoothie',
      }),
      hadClampFlag: true,
    })
    expect(b.halfPct).toBeLessThanOrEqual(MAX_DISPLAYED_HALF_PCT)
  })
})

describe('meal bands compound rather than average', () => {
  const tight: Band = { halfPct: 0.05, tier: 'none', reasons: [] }
  const wide: Band = { halfPct: 0.5, tier: 'very_wide', reasons: ['uncertain'] }

  it('is not the arithmetic mean of its items', () => {
    const b = mealBand([{ kcal: 500, band: tight }, { kcal: 500, band: wide }])
    const mean = (0.05 + 0.5) / 2
    expect(b.halfPct).not.toBeCloseTo(mean, 3)
  })

  it('is never more certain than its dominant contributor', () => {
    // One 900 kcal uncertain main plus three tiny confident sides.
    const b = mealBand([
      { kcal: 900, band: wide },
      { kcal: 20, band: tight },
      { kcal: 20, band: tight },
      { kcal: 20, band: tight },
    ])
    expect(b.halfPct).toBeGreaterThanOrEqual(wide.halfPct * 0.7)
  })

  it('lets a small uncertain side stay small against a labeled main', () => {
    const b = mealBand([{ kcal: 900, band: tight }, { kcal: 30, band: wide }])
    expect(b.halfPct).toBeLessThan(0.2)
  })

  it('handles an empty or zero-calorie meal without NaN', () => {
    expect(mealBand([]).halfPct).toBe(0)
    expect(mealBand([{ kcal: 0, band: tight }]).halfPct).toBe(0)
  })

  it('merges and deduplicates item reasons', () => {
    const b = mealBand([
      { kcal: 100, band: { halfPct: 0.3, tier: 'moderate', reasons: ['a', 'b'] } },
      { kcal: 100, band: { halfPct: 0.3, tier: 'moderate', reasons: ['b', 'c'] } },
    ])
    expect(b.reasons.sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('presentation', () => {
  it('maps half-widths onto ordered tiers', () => {
    expect(bandTier(0.02)).toBe('none')
    expect(bandTier(0.12)).toBe('tight')
    expect(bandTier(0.25)).toBe('moderate')
    expect(bandTier(0.4)).toBe('wide')
    expect(bandTier(0.55)).toBe('very_wide')
  })

  it('has a glyph for every tier, so confidence is legible without colour', () => {
    for (const t of ['none', 'tight', 'moderate', 'wide', 'very_wide'] as const) {
      expect(TIER_GLYPH[t]).toBeTruthy()
    }
  })

  it('computes the displayed range from the band', () => {
    const r = rangeFor(500, { halfPct: 0.2, tier: 'moderate', reasons: [] })
    expect(r.low).toBeCloseTo(400, 6)
    expect(r.high).toBeCloseTo(600, 6)
  })
})

describe('category classification', () => {
  it('routes a label to packaged, a drink to liquid, a stir fry to composite', () => {
    expect(classifyCategory(item({ legible_label_text: 'x' }))).toBe('packaged_labeled')
    expect(classifyCategory(item({ is_beverage: true }))).toBe('liquid')
    expect(classifyCategory(item({ canonical_food_key: 'chicken stir fry' }))).toBe('mixed_composite')
    expect(classifyCategory(item({ cooking_method_cues: ['batter_or_breading'] }))).toBe('hidden_fat_likely')
    expect(classifyCategory(item({ canonical_food_key: 'banana, raw', cooking_method_cues: ['none_visible'] }))).toBe('whole_food')
  })
})

describe('baselines ship honestly labeled', () => {
  it('declares itself seeded until the harness has run', () => {
    expect(SEEDED_BASELINES.provenance['all']).toBe('seeded')
    expect(SEEDED_BASELINES.generatedAt).toBeNull()
  })
})
