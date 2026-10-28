import type { IngredientRow } from '@nutai/core-schema'

/**
 * Whether a meal's numbers come from exact sources (a barcode, a printed label, a
 * published page, or a product the user picked by hand) rather than from a photo
 * estimate. Exact meals are shown to 0.1; photo estimates keep whole numbers,
 * because a decimal on a guess would claim precision the app does not have.
 */
const EXACT_ORIGINS: ReadonlySet<IngredientRow['origin']> = new Set([
  'barcode',
  'label_ocr',
  'web_lookup',
  'manual_custom',
])

export function isPreciseMeal(rows: readonly IngredientRow[]): boolean {
  return rows.length > 0 && rows.every((r) => EXACT_ORIGINS.has(r.origin) || r.origin === 'assumption_filler')
}
