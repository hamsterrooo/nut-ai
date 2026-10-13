import { describe, expect, it } from 'vitest'
import { kcalFromKj, LabelPayloadZ, sodiumMgFromSaltG, WebLookupResultZ } from './index.js'

const panel = {
  calories_kcal: 250,
  protein_g: 10,
  carbs_g: 30,
  fat_g: 8,
  fiber_g: 2,
  sugar_g: 5,
  sodium_mg: null,
}
const label = (per: object) => ({
  product_name: 'Jogurt naturalny',
  serving_desc: '100 g',
  serving_g: 100,
  servings_per_container: null,
  per_serving: per,
})

describe('EU conversions', () => {
  it('converts salt to sodium (1 g salt = 400 mg sodium)', () => {
    expect(sodiumMgFromSaltG(1)).toBe(400)
    expect(sodiumMgFromSaltG(1.2)).toBeCloseTo(480, 6)
  })
  it('converts kJ to kcal, rounded', () => {
    expect(kcalFromKj(1046)).toBe(250)
    expect(kcalFromKj(0)).toBe(0)
  })
})

describe('LabelPayloadZ with EU panels', () => {
  it('derives sodium from printed salt', () => {
    const r = LabelPayloadZ.parse(label({ ...panel, salt_g: 1.2 }))
    expect(r.per_serving.sodium_mg).toBeCloseTo(480, 6)
  })
  it('keeps a printed sodium figure over a derived one', () => {
    const r = LabelPayloadZ.parse(label({ ...panel, sodium_mg: 300, salt_g: 1.2 }))
    expect(r.per_serving.sodium_mg).toBe(300)
  })
  it('leaves sodium null when neither is printed', () => {
    const r = LabelPayloadZ.parse(label(panel))
    expect(r.per_serving.sodium_mg).toBeNull()
  })
  it('falls back to kJ only when kcal was not read', () => {
    const noKcal = LabelPayloadZ.parse(label({ ...panel, calories_kcal: 0, energy_kj: 1046 }))
    expect(noKcal.per_serving.calories_kcal).toBe(250)
    const both = LabelPayloadZ.parse(label({ ...panel, calories_kcal: 247, energy_kj: 1046 }))
    expect(both.per_serving.calories_kcal).toBe(247)
  })
  it('accepts panels that omit the new fields entirely', () => {
    expect(LabelPayloadZ.safeParse(label(panel)).success).toBe(true)
  })
})

describe('WebLookupResultZ with salt', () => {
  const option = {
    label: 'Chleb',
    serving_g: 100,
    serving_desc: '100 g',
    calories_kcal: 250,
    protein_g: 8,
    carbs_g: 48,
    fat_g: 2,
    fiber_g: 4,
    sodium_mg: null,
  }
  it('derives sodium from salt and drops the salt field', () => {
    const r = WebLookupResultZ.parse({
      found: true,
      source_url: 'https://example.pl',
      question: null,
      options: [{ ...option, salt_g: 1.0 }],
    })
    expect(r.options[0]!.sodium_mg).toBe(400)
    expect('salt_g' in r.options[0]!).toBe(false)
  })
})
