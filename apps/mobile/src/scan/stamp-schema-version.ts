import { SCHEMA_VERSION } from '@nutai/core-schema'

/**
 * The model is not relied on to produce schema_version: it is a constant of OUR
 * contract, not something the photo can change. Stamp it before validation so a
 * response without it (or from the no-schema fallback call) is judged on the
 * fields that actually come from the model.
 */
export function stampSchemaVersion(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  return { ...(raw as Record<string, unknown>), schema_version: SCHEMA_VERSION }
}
