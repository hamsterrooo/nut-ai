import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { loadMealDetail, saveMealEdit } from './meal-edit'

let db: DbAdapter
const NOW = 1_754_100_000_000

async function seedMeal(): Promise<number> {
  const m = await db.run(
    `INSERT INTO meals (logged_at, local_date, portion_eaten_fraction, analysis_status, created_at)
     VALUES (?,?,1.0,'complete',?)`,
    [NOW, '2026-10-28', NOW],
  )
  const mealId = Number(m.lastInsertRowId)
  for (const [i, [name, g]] of (
    [
      ['Makaron', 200],
      ['Sos', 50],
    ] as const
  ).entries()) {
    await db.run(
      `INSERT INTO log_items (meal_id, matched_food_source, display_name, grams, gram_pathway, portion_source,
                              snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, sort_order, logged_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [mealId, 'corpus', name, g, 'model_guess', 'db_search', 100, 4, 1, 20, i, NOW + i * 1000],
    )
  }
  return mealId
}

beforeEach(async () => {
  db = openMemoryDb()
  await db.exec('PRAGMA foreign_keys = ON;')
  await migrate(db, NOW)
})

describe('meal edit', () => {
  it('migration v4 adds title and note', async () => {
    const cols = await db.all<{ name: string }>('PRAGMA table_info(meals)')
    expect(cols.map((c) => c.name)).toEqual(expect.arrayContaining(['title', 'note']))
  })

  it('loads items in order with their add times', async () => {
    const id = await seedMeal()
    const d = (await loadMealDetail(db, id))!
    expect(d.items.map((i) => i.name)).toEqual(['Makaron', 'Sos'])
    expect(d.items[1]!.addedAt).toBe(NOW + 1000)
    expect(d.title).toBeNull()
  })

  it('saves title, note, new grams and removals; snapshots stay put', async () => {
    const id = await seedMeal()
    const before = (await loadMealDetail(db, id))!
    await saveMealEdit(db, id, {
      title: '  Obiad  ',
      note: 'u mamy',
      grams: { [before.items[0]!.id]: 250 },
      remove: [before.items[1]!.id],
    })
    const after = (await loadMealDetail(db, id))!
    expect(after.title).toBe('Obiad')
    expect(after.note).toBe('u mamy')
    expect(after.items).toHaveLength(1)
    expect(after.items[0]!.grams).toBe(250)
    expect(after.items[0]!.kcalPer100).toBe(100)
  })

  it('stores blank title and note as NULL, and ignores negative grams', async () => {
    const id = await seedMeal()
    const d = (await loadMealDetail(db, id))!
    await saveMealEdit(db, id, { title: ' ', note: '', grams: { [d.items[0]!.id]: -5 }, remove: [] })
    const after = (await loadMealDetail(db, id))!
    expect(after.title).toBeNull()
    expect(after.note).toBeNull()
    expect(after.items[0]!.grams).toBe(200)
  })
})
