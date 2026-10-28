import { describe, expect, it } from 'vitest'
import { NUTRITION_FTS_SCHEMA, NUTRITION_SCHEMA, MIGRATIONS } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { loadPortionOptions, parsePositive, portionLabel, saveUserPortion, totalGrams } from './portion-options'
import { resolveSelection } from './food-search-select'

describe('parsePositive', () => {
  it('accepts comma and dot decimals and rejects junk', () => {
    expect(parsePositive('1,5')).toBe(1.5)
    expect(parsePositive(' 250 ')).toBe(250)
    for (const bad of ['', 'abc', '0', '-3', 'Infinity']) expect(parsePositive(bad)).toBeNull()
  })
})

describe('portionLabel', () => {
  it('drops numeric modifier codes and undetermined units', () => {
    expect(portionLabel(1, 'cup', 'chopped')).toBe('1 cup chopped')
    expect(portionLabel(2, 'slice', '1234')).toBe('2 slice')
    expect(portionLabel(1, 'undetermined', null)).toBe('1 porcja')
  })
})

describe('totalGrams', () => {
  const cookie = { id: 'u', label: 'ciastko', grams: 25, source: 'user' as const }
  it('multiplies by the unit weight, and passes grams through', () => {
    expect(totalGrams(3, cookie)).toBe(75)
    expect(totalGrams(1.5, cookie)).toBe(37.5)
    expect(totalGrams(180, null)).toBe(180)
  })
  it('rejects out-of-range totals', () => {
    expect(totalGrams(0, null)).toBeNull()
    expect(totalGrams(20000, null)).toBeNull()
    expect(totalGrams(5000, cookie)).toBeNull()
  })
})

describe('loadPortionOptions / saveUserPortion', () => {
  async function setup() {
    const nutrition = openMemoryDb()
    await nutrition.exec(NUTRITION_SCHEMA)
    await nutrition.exec(NUTRITION_FTS_SCHEMA)
    await nutrition.run(
      `INSERT INTO foods (id, source, name, energy_kcal, serving_size_g, serving_desc, license, basis_confidence, completeness_score)
       VALUES (1,'off_pl','Ciastka maślane',480,25,'1 ciastko','ODbL','high',0.9)`,
    )
    await nutrition.run(
      `INSERT INTO food_portions (food_id, measure_unit, modifier, amount, gram_weight, is_fndds_default) VALUES (1,'cup','crumbled',1,120,1)`,
    )
    const user = openMemoryDb()
    for (const m of MIGRATIONS) await user.exec(m.sql)
    return { nutrition, user }
  }

  it('lists the product serving and corpus portions', async () => {
    const { nutrition } = await setup()
    const opts = await loadPortionOptions(nutrition, null, { foodId: '1', name: 'Ciastka maślane' })
    expect(opts.map((o) => [o.label, o.grams])).toEqual([['1 ciastko', 25], ['1 cup crumbled', 120]])
  })

  it('remembers a user unit per product name and lists it first', async () => {
    const { nutrition, user } = await setup()
    const saved = await saveUserPortion(user, 'Ciastka maślane', ' kawałek ', 12.5, 1)
    expect(saved?.label).toBe('kawałek')
    const opts = await loadPortionOptions(nutrition, user, { foodId: 1, name: 'Ciastka maślane' })
    expect(opts[0]).toMatchObject({ label: 'kawałek', grams: 12.5, source: 'user' })
    const other = await loadPortionOptions(nutrition, user, { foodId: 1, name: 'Inny produkt' })
    expect(other.some((o) => o.source === 'user')).toBe(false)
  })

  it('refuses unusable units', async () => {
    const { user } = await setup()
    expect(await saveUserPortion(user, 'X', '  ', 10, 1)).toBeNull()
    expect(await saveUserPortion(user, 'X', 'szt', 0, 1)).toBeNull()
    expect(await saveUserPortion(user, 'X', 'szt', 99999, 1)).toBeNull()
  })

  it('replaces the weight when the same unit is saved again', async () => {
    const { nutrition, user } = await setup()
    await saveUserPortion(user, 'Ciastka maślane', 'szt', 20, 1)
    await saveUserPortion(user, 'Ciastka maślane', 'szt', 30, 2)
    const opts = await loadPortionOptions(nutrition, user, { foodId: 1, name: 'Ciastka maślane' })
    expect(opts.filter((o) => o.label === 'szt')).toEqual([expect.objectContaining({ grams: 30 })])
  })
})

describe('resolveSelection grams override', () => {
  it('uses typed grams instead of the default portion', async () => {
    const nutrition = openMemoryDb()
    await nutrition.exec(NUTRITION_SCHEMA)
    await nutrition.exec(NUTRITION_FTS_SCHEMA)
    await nutrition.run(`INSERT INTO foods (id, source, name, energy_kcal, license, basis_confidence, completeness_score) VALUES (1,'off_pl','X',100,'ODbL','high',0.9)`)
    const cand = { foodId: '1', name: 'X', energyKcal: 100 } as never
    expect((await resolveSelection(nutrition, cand)).grams).toBe(100)
    expect((await resolveSelection(nutrition, cand, 37)).grams).toBe(37)
  })
})
