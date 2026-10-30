import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { deleteSaved, listHistory, listSaved, logAgain, logSaved, saveMeal, saveProduct } from './saved-meals'

let db: DbAdapter
const NOW = 1_754_100_000_000

beforeEach(async () => {
  db = openMemoryDb()
  await db.exec('PRAGMA foreign_keys = ON;')
  await migrate(db, NOW)
})

async function meal(at: number, fraction: number, items: Array<[string, number, number]>, title: string | null = null): Promise<number> {
  const m = await db.run(
    `INSERT INTO meals (logged_at, local_date, portion_eaten_fraction, analysis_status, created_at, title)
     VALUES (?,?,?,'complete',?,?)`,
    [at, '2026-10-29', fraction, at, title],
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
                   FROM meals m JOIN log_items li ON li.meal_id = m.id WHERE m.id = ?`

describe('saved entries', () => {
  it('saves a meal once, and logging it again reproduces its eaten calories', async () => {
    const id = await meal(NOW, 0.5, [['Jogurt', 150, 60], ['Biszkopt', 40, 350]], 'Śniadanie')
    const first = await saveMeal(db, id, NOW)
    const second = await saveMeal(db, id, NOW + 1)
    expect(first?.created).toBe(true)
    expect(second).toEqual({ id: first!.id, created: false })

    const saved = await listSaved(db)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.name).toBe('Śniadanie')
    const original = (await db.get<{ kcal: number }>(TOTAL_SQL, [id]))!.kcal
    expect(saved[0]!.kcal).toBeCloseTo(original, 6)

    const again = await logSaved(db, first!.id, NOW + 5000)
    expect((await db.get<{ kcal: number }>(TOTAL_SQL, [again!]))!.kcal).toBeCloseTo(original, 6)
    expect((await listSaved(db))[0]!.useCount).toBe(1)
  })

  it('saves a single product and deletes it', async () => {
    const r = await saveProduct(
      db,
      { foodId: null, name: 'Biszkopt', grams: 17, kcal: 539, protein: 4, fat: 31, carbs: 60, fiber: null, sugar: null, sodium: null },
      NOW,
    )
    const e = (await listSaved(db))[0]!
    expect(e.kcal).toBeCloseTo(91.63, 2)
    await deleteSaved(db, r.id)
    expect(await listSaved(db)).toHaveLength(0)
  })
})

describe('history', () => {
  it('lists newest first and logs a past meal again as a new meal', async () => {
    const a = await meal(NOW, 1, [['Jogurt', 150, 60]])
    const b = await meal(NOW + 1000, 1, [['Chleb', 60, 250]])
    const h = await listHistory(db)
    expect(h.map((e) => e.id)).toEqual([b, a])
    expect(h[0]!.kcal).toBeCloseTo(150, 6)

    const copy = await logAgain(db, a, NOW + 9000)
    expect(copy).not.toBe(a)
    expect((await listHistory(db)).length).toBe(3)
    expect((await db.get<{ kcal: number }>(TOTAL_SQL, [copy!]))!.kcal).toBeCloseTo(90, 6)
  })
})
