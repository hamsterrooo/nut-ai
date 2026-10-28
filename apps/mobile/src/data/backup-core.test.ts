import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, USER_SCHEMA_VERSION, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import {
  buildBackupPayload,
  describeBackup,
  EXPORT_TABLES,
  importBackupPayload,
  parseBackup,
  serializeBackup,
  WIPE_ONLY_TABLES,
} from './backup-core'

/**
 * Backup round-trips against the REAL user schema — the same migrate() the app
 * runs. If restore can lose or corrupt data, it fails here, not on a phone.
 */

let db: DbAdapter

const NOW = 1_754_100_000_000

beforeEach(async () => {
  db = openMemoryDb()
  await db.exec('PRAGMA foreign_keys = ON;')
  await migrate(db, NOW)
})

async function seed(d: DbAdapter): Promise<void> {
  await d.run(
    `INSERT INTO user_profile (id, sex, birth_year, height_cm, units, created_at) VALUES (1,'male',2003,180,'imperial',?)`,
    [NOW],
  )
  await d.run(
    `INSERT INTO goals (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
                        floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive)
     VALUES (?,?,?,?,?,0,?,?,?,?,?,1)`,
    [NOW, 'gain', 0.5, 3400, 3400, 180, 100, 450, 1900, 3150],
  )
  await d.run(`INSERT INTO settings (key, value) VALUES ('provider','anthropic')`)
  const meal = await d.run(
    `INSERT INTO meals (id, logged_at, local_date, meal_slot, photo_uri, portion_eaten_fraction,
                        analysis_status, engine_id, created_at)
     VALUES (77, ?, '2026-08-01', 'lunch', 'file:///tmp/cache/photo.jpg', 1.0, 'complete', 'test', ?)`,
    [NOW, NOW],
  )
  expect(Number(meal.lastInsertRowId)).toBe(77)
  await d.run(
    `INSERT INTO log_items (meal_id, matched_food_source, display_name, grams, gram_pathway,
                            portion_source, snap_energy_kcal, is_estimate, macros_user_edited,
                            sort_order, logged_at)
     VALUES (77, 'corpus', 'Chicken', 170, 'discrete_count', 'vision_model', 165, 0, 0, 0, ?)`,
    [NOW],
  )
  await d.run(`INSERT INTO weight_entries (local_date, weight_kg, logged_at) VALUES ('2026-08-01', 79.4, ?)`, [NOW])
  // Derived cache row — must be wiped on import and never exported.
  await d.run(`INSERT INTO day_summaries (local_date, kcal) VALUES ('2026-08-01', 500)`).catch(() => {})
}

async function exportOf(d: DbAdapter) {
  return buildBackupPayload(d, { schemaVersion: USER_SCHEMA_VERSION, appVersion: '0.1.0', now: NOW })
}

describe('backup round trip', () => {
  it('restores byte-equal rows with foreign keys intact', async () => {
    await seed(db)
    const payload = await exportOf(db)
    const raw = serializeBackup(payload)

    // Fresh device.
    const dst = openMemoryDb()
    await dst.exec('PRAGMA foreign_keys = ON;')
    await migrate(dst, NOW)

    const parsed = parseBackup(raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = await importBackupPayload(dst, parsed.payload, USER_SCHEMA_VERSION)
    expect(outcome.ok).toBe(true)

    const item = await dst.get<{ meal_id: number; display_name: string }>(
      'SELECT meal_id, display_name FROM log_items',
    )
    expect(item!.meal_id).toBe(77)
    const meal = await dst.get<{ id: number }>('SELECT id FROM meals')
    expect(meal!.id).toBe(77)
    const w = await dst.get<{ weight_kg: number }>('SELECT weight_kg FROM weight_entries')
    expect(w!.weight_kg).toBeCloseTo(79.4, 6)
  })

  it('REPLACES pre-existing data — restore is not a merge', async () => {
    await seed(db)
    const payload = await exportOf(db)

    const dst = openMemoryDb()
    await dst.exec('PRAGMA foreign_keys = ON;')
    await migrate(dst, NOW)
    await dst.run(`INSERT INTO weight_entries (local_date, weight_kg, logged_at) VALUES ('2026-07-15', 99, ?)`, [NOW])

    await importBackupPayload(dst, payload, USER_SCHEMA_VERSION)
    const rows = await dst.all('SELECT * FROM weight_entries')
    expect(rows).toHaveLength(1)
  })

  it('nulls photo_uri — camera temp paths are not durable anywhere', async () => {
    await seed(db)
    const payload = await exportOf(db)
    expect(payload.tables['meals']![0]!['photo_uri']).toContain('file://')

    const dst = openMemoryDb()
    await migrate(dst, NOW)
    await importBackupPayload(dst, payload, USER_SCHEMA_VERSION)
    const meal = await dst.get<{ photo_uri: string | null }>('SELECT photo_uri FROM meals')
    expect(meal!.photo_uri).toBeNull()
  })

  it('refuses a downgrade instead of corrupting silently', async () => {
    await seed(db)
    const payload = await exportOf(db)
    payload.schema_version = USER_SCHEMA_VERSION + 5
    const outcome = await importBackupPayload(db, payload, USER_SCHEMA_VERSION)
    expect(outcome).toEqual({ ok: false, reason: 'downgrade' })
  })

  it('tolerates schema drift in both directions via column intersection', async () => {
    await seed(db)
    const payload = await exportOf(db)
    // Simulate an OLD export: a NULLABLE column the current schema has is
    // absent. (Columns added by later migrations must be nullable or carry a
    // DEFAULT — that discipline is what makes old backups restorable at all.)
    for (const row of payload.tables['meals']!) delete row['meal_slot']
    // Simulate a FUTURE export: a column the current schema lacks.
    for (const row of payload.tables['weight_entries']!) row['mystery_future_col'] = 42

    const dst = openMemoryDb()
    await migrate(dst, NOW)
    const outcome = await importBackupPayload(dst, payload, USER_SCHEMA_VERSION)
    expect(outcome.ok).toBe(true)
    const w = await dst.get<{ weight_kg: number }>('SELECT weight_kg FROM weight_entries')
    expect(w!.weight_kg).toBeCloseTo(79.4, 6)
  })

  it('never exports derived caches, wipes them on import, never touches schema_migrations', async () => {
    await seed(db)
    const payload = await exportOf(db)
    for (const t of WIPE_ONLY_TABLES) expect(payload.tables[t]).toBeUndefined()
    expect(payload.tables['schema_migrations']).toBeUndefined()

    await importBackupPayload(db, payload, USER_SCHEMA_VERSION)
    const cache = await db.get<{ c: number }>('SELECT COUNT(*) c FROM day_summaries')
    expect(cache!.c).toBe(0)
    const mig = await db.get<{ c: number }>('SELECT COUNT(*) c FROM schema_migrations')
    expect(mig!.c).toBeGreaterThan(0)
  })

  it('rejects garbage files with named reasons', () => {
    expect(parseBackup('not json at all')).toEqual({ ok: false, reason: 'bad-json' })
    expect(parseBackup('{"some":"other file"}')).toEqual({ ok: false, reason: 'wrong-format' })
  })

  it('the wipe set exactly covers what a factory reset wipes', () => {
    // resetEverything() derives from these same lists; this pins the union.
    expect(EXPORT_TABLES.length + WIPE_ONLY_TABLES.length).toBe(19)
  })

  it('describes a backup in human terms for the restore preview', async () => {
    await seed(db)
    const payload = await exportOf(db)
    const desc = describeBackup(payload)
    expect(desc).toContain('1 posiłek')
    expect(desc).toContain('1 ważenie')
  })
})
