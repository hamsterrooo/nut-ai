import type { DbAdapter, RunResult, SqlValue } from '@nutai/db-adapter'
import * as SQLite from 'expo-sqlite'

/**
 * The expo-sqlite implementation of the shared DbAdapter interface.
 *
 * This file lives in apps/mobile and NOT in @nutai/db-adapter, deliberately.
 * `packages/*` must stay importable under bare Node with zero React Native
 * surface (PLAN.md §4.1) so the eval harness can run the real pipeline; an
 * `import 'expo-sqlite'` in that package would fail the node-purity gate. This
 * app is the only place allowed to hold React Native imports.
 *
 * The Node implementation lives at @nutai/db-adapter/node. Both satisfy the same
 * interface, which is what makes "it worked in the harness" mean something on
 * device.
 */
class ExpoDbAdapter implements DbAdapter {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async all<T = Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return (await this.db.getAllAsync(sql, params as SQLite.SQLiteBindValue[])) as T[]
  }

  async get<T = Record<string, SqlValue>>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    return ((await this.db.getFirstAsync(sql, params as SQLite.SQLiteBindValue[])) as T | null) ?? null
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
    const r = await this.db.runAsync(sql, params as SQLite.SQLiteBindValue[])
    return { changes: r.changes, lastInsertRowId: r.lastInsertRowId }
  }

  async exec(sql: string): Promise<void> {
    await this.db.execAsync(sql)
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    let result!: T
    await this.db.withTransactionAsync(async () => {
      result = await fn(this)
    })
    return result
  }

  async close(): Promise<void> {
    await this.db.closeAsync()
  }
}

/** The writable user database. */
export async function openUserDb(): Promise<DbAdapter> {
  const db = await SQLite.openDatabaseAsync('user.db')
  await db.execAsync('PRAGMA foreign_keys = ON;')
  return new ExpoDbAdapter(db)
}

/**
 * The read-only bundled nutrition corpus.
 *
 * The artifact built by tools/nutrition-data ships as an app asset and is
 * imported into the SQLite directory on first launch, because FTS5 needs a real
 * writable path for its temporary files. The app never writes to it — the copy
 * exists for SQLite's benefit, not ours, and a corpus update replaces the file
 * wholesale rather than mutating it.
 *
 * The import is idempotent BY FILE NAME, so an app update alone never replaces an
 * already-imported copy. The name therefore carries a version: bump
 * NUTRITION_DB_FILE whenever the corpus changes (new tier, new snapshot) and the
 * next launch imports the new asset under the new name and removes the old copy.
 *
 * WITHOUT THIS IMPORT the app opens an EMPTY database of the same name, and every
 * food silently falls to the AI-estimate path — which looks exactly like a
 * resolver bug while actually being a missing asset. Hence `nutritionCorpusInfo`
 * below, so that failure is legible rather than mysterious.
 */
const NUTRITION_DB_FILE = 'nutrition-v2.db'
/** Earlier file names, deleted after a successful import to reclaim the space. */
const NUTRITION_DB_LEGACY_FILES = ['nutrition.db']

let nutritionImported = false

export async function openNutritionDb(): Promise<DbAdapter> {
  if (!nutritionImported) {
    try {
      await SQLite.importDatabaseFromAssetAsync(NUTRITION_DB_FILE, {
        assetId: require('../../assets/nutrition.db'),
        // Idempotent by name. Re-copying the corpus on every cold start would be
        // a visible delay for nothing.
        forceOverwrite: false,
      })
    } catch {
      // Already imported by a previous launch — the common path.
    }
    for (const legacy of NUTRITION_DB_LEGACY_FILES) {
      try {
        await SQLite.deleteDatabaseAsync(legacy)
      } catch {
        // Not present (fresh install or already removed).
      }
    }
    nutritionImported = true
  }

  const db = await SQLite.openDatabaseAsync(NUTRITION_DB_FILE)
  return new ExpoDbAdapter(db)
}

/**
 * Confirm the corpus actually arrived.
 *
 * A build shipped without the asset answers every query with zero rows, which is
 * indistinguishable at the UI from "no match found". Surfacing the row count
 * turns a silent, confusing failure into an obvious one.
 */
export async function nutritionCorpusInfo(
  db: DbAdapter,
): Promise<{ foods: number; portions: number; builtAt: string | null }> {
  try {
    const foods = await db.get<{ c: number }>('SELECT COUNT(*) c FROM foods')
    const portions = await db.get<{ c: number }>('SELECT COUNT(*) c FROM food_portions')
    const built = await db.get<{ value: string }>(
      "SELECT value FROM build_manifest WHERE key = 'built_at'",
    )
    return { foods: foods?.c ?? 0, portions: portions?.c ?? 0, builtAt: built?.value ?? null }
  } catch {
    return { foods: 0, portions: 0, builtAt: null }
  }
}
