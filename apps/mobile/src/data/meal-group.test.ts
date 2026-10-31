import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { dissolveIfAlone, groupMeals, removeFromGroup, ungroup } from './meal-edit'

let db: DbAdapter
const NOW = 1_754_100_000_000

beforeEach(async () => {
  db = openMemoryDb()
  await db.exec('PRAGMA foreign_keys = ON;')
  await migrate(db, NOW)
})

async function meal(at: number, status = 'complete'): Promise<number> {
  const m = await db.run(
    `INSERT INTO meals (logged_at, local_date, portion_eaten_fraction, analysis_status, created_at)
     VALUES (?,?,1.0,?,?)`,
    [at, '2026-10-31', status, at],
  )
  const id = Number(m.lastInsertRowId)
  await db.run(
    `INSERT INTO log_items (meal_id, matched_food_source, display_name, grams, gram_pathway, portion_source,
                            snap_energy_kcal, sort_order, logged_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, 'corpus', 'Produkt', 100, 'model_guess', 'db_search', 100, 0, at],
  )
  return id
}

const groupOf = async (id: number) => (await db.get<{ g: number | null }>('SELECT group_id AS g FROM meals WHERE id = ?', [id]))!.g

describe('groupMeals', () => {
  it('sets one group id (the earliest meal) and merges nothing', async () => {
    const a = await meal(NOW)
    const b = await meal(NOW + 1000)
    expect(await groupMeals(db, [b, a])).toBe(a)
    expect(await groupOf(a)).toBe(a)
    expect(await groupOf(b)).toBe(a)
    expect((await db.all('SELECT id FROM meals')).length).toBe(2)
    expect((await db.all('SELECT id FROM log_items')).length).toBe(2)
  })

  it('pulls an existing group in whole', async () => {
    const a = await meal(NOW)
    const b = await meal(NOW + 1000)
    const c = await meal(NOW + 2000)
    const d = await meal(NOW + 3000)
    await groupMeals(db, [b, c])
    expect(await groupMeals(db, [a, c, d])).toBe(a)
    for (const id of [a, b, c, d]) expect(await groupOf(id)).toBe(a)
  })

  it('does nothing with fewer than two groupable meals', async () => {
    const a = await meal(NOW)
    const p = await meal(NOW + 1000, 'analyzing')
    expect(await groupMeals(db, [a])).toBeNull()
    expect(await groupMeals(db, [a, a])).toBeNull()
    expect(await groupMeals(db, [a, p])).toBeNull()
    expect(await groupOf(a)).toBeNull()
  })
})

describe('ungroup', () => {
  it('ungroup clears the whole group', async () => {
    const a = await meal(NOW)
    const b = await meal(NOW + 1000)
    const g = (await groupMeals(db, [a, b]))!
    await ungroup(db, g)
    expect(await groupOf(a)).toBeNull()
    expect(await groupOf(b)).toBeNull()
  })

  it('removing one of three keeps the other two grouped; removing one of two dissolves the group', async () => {
    const a = await meal(NOW)
    const b = await meal(NOW + 1000)
    const c = await meal(NOW + 2000)
    await groupMeals(db, [a, b, c])
    await removeFromGroup(db, c)
    expect(await groupOf(c)).toBeNull()
    expect(await groupOf(a)).toBe(a)
    await removeFromGroup(db, b)
    expect(await groupOf(a)).toBeNull()
    expect(await groupOf(b)).toBeNull()
  })

  it('dissolveIfAlone clears a group whose member was deleted', async () => {
    const a = await meal(NOW)
    const b = await meal(NOW + 1000)
    const g = (await groupMeals(db, [a, b]))!
    await db.run('DELETE FROM meals WHERE id = ?', [b])
    await dissolveIfAlone(db, g)
    expect(await groupOf(a)).toBeNull()
  })
})
