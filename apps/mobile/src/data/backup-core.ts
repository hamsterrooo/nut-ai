import { pluralPl } from '../i18n/format'
import type { DbAdapter, SqlValue } from '@nutai/db-adapter'

/**
 * Backup and restore — the pure core.
 *
 * ZERO React Native imports, deliberately: this module runs under bare Node in
 * the test suite against the REAL user schema, which is the only way "restore
 * works" can be a tested claim instead of a hope. The expo-facing file I/O
 * lives in backup.ts.
 *
 * The rules that are not negotiable:
 *
 *   CREDENTIALS NEVER TRAVEL. API keys live in the Keychain, out-of-band from
 *   user.db, and a plaintext JSON export is exactly where a key must not be.
 *   After a restore the user re-enters their key — the restore screen says so.
 *
 *   IMPORT REPLACES, ATOMICALLY. One transaction: delete everything, insert
 *   everything, preserving integer primary keys so meal→item foreign keys
 *   survive byte-for-byte. Half a restore is worse than no restore.
 *
 *   SCHEMA DRIFT IS EXPECTED, NOT FATAL. Inserts use the intersection of the
 *   export's columns and the installed schema's columns (PRAGMA table_info),
 *   so an old backup restores into a newer app, and a column the new app
 *   dropped is ignored rather than crashing the import. The one thing refused
 *   is a DOWNGRADE — a backup from a newer schema than the installed app.
 */

export const BACKUP_FORMAT = 'nutai.backup'
export const BACKUP_FORMAT_VERSION = 1

/**
 * Exported tables, in FOREIGN-KEY-SAFE INSERT ORDER (parents before children:
 * meals before log_items). Deletion happens in the reverse of this order.
 */
export const EXPORT_TABLES = [
  'user_profile',
  'goals',
  'settings',
  'consents',
  'user_foods',
  'user_containers',
  'saved_meals',
  'personal_gram_priors',
  'user_portions',
  'food_attribute_memory',
  'weight_entries',
  'water_entries',
  'exercise_entries',
  'meals',
  'log_items',
  'scan_cost_ledger',
] as const

/**
 * Wiped on import (and by a factory reset) but never exported: derived caches
 * and device-local data that would be dead weight or a guaranteed miss on
 * another device.
 */
export const WIPE_ONLY_TABLES = ['day_summaries', 'scan_cache', 'accuracy_baselines'] as const

export type BackupRow = Record<string, SqlValue>

export interface BackupPayload {
  format: typeof BACKUP_FORMAT
  format_version: number
  schema_version: number
  exported_at: number
  app_version: string
  tables: Record<string, BackupRow[]>
}

export async function buildBackupPayload(
  db: DbAdapter,
  meta: { schemaVersion: number; appVersion: string; now: number },
): Promise<BackupPayload> {
  const tables: Record<string, BackupRow[]> = {}
  for (const t of EXPORT_TABLES) {
    tables[t] = await db.all<BackupRow>(`SELECT * FROM ${t}`)
  }
  return {
    format: BACKUP_FORMAT,
    format_version: BACKUP_FORMAT_VERSION,
    schema_version: meta.schemaVersion,
    exported_at: meta.now,
    app_version: meta.appVersion,
    tables,
  }
}

/** lastInsertRowId can be bigint on some adapters; JSON.stringify throws on it. */
export function serializeBackup(payload: BackupPayload): string {
  return JSON.stringify(payload, (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v))
}

export type ParseFailure = 'bad-json' | 'wrong-format'

export function parseBackup(raw: string):
  | { ok: true; payload: BackupPayload }
  | { ok: false; reason: ParseFailure } {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'bad-json' }
  }
  const p = json as Partial<BackupPayload> | null
  if (
    !p ||
    p.format !== BACKUP_FORMAT ||
    typeof p.schema_version !== 'number' ||
    typeof p.tables !== 'object' ||
    p.tables === null
  ) {
    return { ok: false, reason: 'wrong-format' }
  }
  return { ok: true, payload: p as BackupPayload }
}

export type ImportOutcome =
  | { ok: true; rowCounts: Record<string, number> }
  | { ok: false; reason: 'downgrade' }

/**
 * Wipe-then-insert inside one transaction.
 *
 * Table names come ONLY from the static lists above — never from the file —
 * which is what makes the string interpolation below safe. A backup cannot
 * name a table into this code path.
 */
export async function importBackupPayload(
  db: DbAdapter,
  payload: BackupPayload,
  installedSchemaVersion: number,
): Promise<ImportOutcome> {
  if (payload.schema_version > installedSchemaVersion) {
    return { ok: false, reason: 'downgrade' }
  }

  const rowCounts: Record<string, number> = {}

  // Schema introspection happens OUTSIDE the write transaction: it's metadata,
  // not part of the atomic change — and expo-sqlite is happier not mixing
  // PRAGMA reads into an exclusive transaction.
  const columnsByTable = new Map<string, Set<string>>()
  for (const t of EXPORT_TABLES) {
    const installed = await db.all<{ name: string }>(`PRAGMA table_info(${t})`)
    columnsByTable.set(t, new Set(installed.map((c) => c.name)))
  }

  await db.transaction(async (tx) => {
    // Children before parents.
    const wipeOrder: string[] = [...([...EXPORT_TABLES] as string[]).reverse(), ...WIPE_ONLY_TABLES]
    for (const t of wipeOrder) {
      try {
        await tx.run(`DELETE FROM ${t}`)
      } catch {
        // A table a future schema removed. Nothing to wipe is fine.
      }
    }

    for (const t of EXPORT_TABLES) {
      const rows = payload.tables[t]
      if (!rows || rows.length === 0) {
        rowCounts[t] = 0
        continue
      }

      const installedCols = columnsByTable.get(t) ?? new Set<string>()
      const cols = Object.keys(rows[0]!).filter((c) => installedCols.has(c))
      if (cols.length === 0) {
        rowCounts[t] = 0
        continue
      }

      const placeholders = cols.map(() => '?').join(',')
      const sql = `INSERT INTO ${t} (${cols.join(',')}) VALUES (${placeholders})`
      let n = 0
      for (const row of rows) {
        const values = cols.map((c) => {
          // Camera temp URIs are not durable even on the same device. A broken
          // path is worse than an honest null.
          if (t === 'meals' && c === 'photo_uri') return null
          return row[c] ?? null
        })
        await tx.run(sql, values)
        n++
      }
      rowCounts[t] = n
    }
  })

  return { ok: true, rowCounts }
}

/** Human summary for the restore preview: "142 meals · 38 weigh-ins · …" */
export function describeBackup(payload: BackupPayload): string {
  const count = (t: string) => payload.tables[t]?.length ?? 0
  const parts: string[] = []
  if (count('meals')) parts.push(`${count('meals')} ${pluralPl(count('meals'), 'posiłek', 'posiłki', 'posiłków')}`)
  if (count('weight_entries')) parts.push(`${count('weight_entries')} ${pluralPl(count('weight_entries'), 'ważenie', 'ważenia', 'ważeń')}`)
  if (count('exercise_entries')) parts.push(`${count('exercise_entries')} ${pluralPl(count('exercise_entries'), 'trening', 'treningi', 'treningów')}`)
  if (count('saved_meals')) parts.push(`${count('saved_meals')} ${pluralPl(count('saved_meals'), 'zapisany produkt', 'zapisane produkty', 'zapisanych produktów')}`)
  return parts.length ? parts.join(' · ') : 'tylko ustawienia i cele'
}
