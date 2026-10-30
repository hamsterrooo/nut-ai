import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { loadMealDetail, mergeMeals, saveMealEdit } from './meal-edit'

let db: DbAdapter
const NOW = 1_754_100_000_000

beforeEach(async () => {
  db = openMemoryDb()
  await db.exec('PRAGMA foreign_keys = ON;')
  await migrate(db, NOW)
})

async function meal(at: number, fraction: number, items: Array<[string, number, number]>): Promise<number> {
  const m = await db.run(
    `INSERT INTO meals (logged_at, local_date, portion_eaten_fraction, analysis_status, created_at)
     VALUES (?,?,?,'complete',?)`,
    [at, '2026-10-29', fraction, at],
  )
  const id = Number(m.lastInsertRowId)
  for (const [i, [name, grams, kcal]] of items.entries()) {
    await db.run(
      `INSERT INTO log_items (meal_id, matched_food_source, display_name, grams, gram_pathway, portion_source,
                              snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, sort_order, logged_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, 'corpus', name, grams, 'model_guess', 'db_search', kcal, 5, 2, 20, i, at],
    )
  }
  return id
}

const TOTAL_SQL = `SELECT SUM(li.snap_energy_kcal * li.grams / 100.0 * m.portion_eaten_fraction) AS kcal
                   FROM meals m JOIN log_items li ON li.meal_id = m.id`

describe('mergeMeals', () => {
  it('keeps the day total, folds portion fractions into grams and leaves one meal', async () => {
    const a = await meal(NOW, 1, [['Jogurt', 150, 60]])
    const b = await meal(NOW + 1000, 0.5, [['Biszkopt', 40, 350], ['Dżem', 20, 250]])
    const before = (await db.get<{ kcal: number }>(TOTAL_SQL))!.kcal

    expect(await mergeMeals(db, [b, a])).toBe(a)

    const after = (await db.get<{ kcal: number }>(TOTAL_SQL))!.kcal
    expect(after).toBeCloseTo(before, 6)
    expect((await db.all('SELECT id FROM meals')).length).toBe(1)
    const d = (await loadMealDetail(db, a))!
    expect(d.portionEaten).toBe(1)
    expect(d.items.map((i) => i.name)).toEqual(['Jogurt', 'Biszkopt', 'Dżem'])
  })

  it('does nothing with fewer than two meals', async () => {
    const a = await meal(NOW, 1, [['Jogurt', 150, 60]])
    expect(await mergeMeals(db, [a])).toBeNull()
    expect(await mergeMeals(db, [a, a])).toBeNull()
  })
})

describe('saveMealEdit replace and add', () => {
  it('swaps the product keeping grams, and appends a new ingredient', async () => {
    const a = await meal(NOW, 1, [['Jogurt', 150, 60]])
    const d = (await loadMealDetail(db, a))!
    await saveMealEdit(db, a, {
      title: '',
      note: '',
      grams: {},
      remove: [],
      replace: {
        [d.items[0]!.id]: { foodId: null, name: 'Jogurt grecki', kcal: 120, protein: 9, fat: 6, carbs: 4, fiber: null, sugar: null, sodium: null },
      },
      add: [{ foodId: null, name: 'Miód', grams: 10, kcal: 300, protein: 0, fat: 0, carbs: 80, fiber: null, sugar: null, sodium: null }],
    })
    const after = (await loadMealDetail(db, a))!
    expect(after.items.map((i) => i.name)).toEqual(['Jogurt grecki', 'Miód'])
    expect(after.items[0]!.grams).toBe(150)
    expect(after.items[0]!.kcalPer100).toBe(120)
    expect(after.items[1]!.grams).toBe(10)
  })
})
