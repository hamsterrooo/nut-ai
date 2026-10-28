import type { DbAdapter } from '@nutai/db-adapter'

/**
 * Helper units for the "how much?" panel on the food database screen: the
 * product's own portions from the corpus, plus units the user defined
 * ("1 ciastko = 25 g"), remembered per product name. ZERO React Native imports so
 * it runs under bare Node like food-search-select.ts.
 */

export interface PortionOption {
  id: string
  /** What one unit is called, e.g. "1 cup, chopped" or "ciastko". */
  label: string
  /** Weight of ONE unit. */
  grams: number
  source: 'user' | 'corpus'
}

export const MAX_GRAMS = 10000
const MAX_UNIT_GRAMS = 5000
const MAX_QUANTITY = 1000
const MAX_CORPUS_OPTIONS = 8

/** Accepts "1,5" and "1.5"; null for anything that is not a positive finite number. */
export function parsePositive(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

function trimNumber(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** "1 cup, chopped" from an FDC row. Numeric modifier codes and "undetermined" units carry no meaning and are dropped. */
export function portionLabel(amount: number | null, unit: string | null, modifier: string | null): string {
  const u = (unit ?? '').trim().toLowerCase()
  const m = (modifier ?? '').trim()
  const parts = [
    amount != null && amount > 0 ? trimNumber(amount) : '1',
    u === '' || u === 'undetermined' ? '' : u,
    /^\d+$/.test(m) ? '' : m,
  ].filter((x) => x !== '')
  return parts.length === 1 ? `${parts[0]} porcja` : parts.join(' ')
}

/** Total grams for `quantity` units. With no option the quantity already is grams. null when out of range. */
export function totalGrams(quantity: number, option: PortionOption | null): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  if (option && quantity > MAX_QUANTITY) return null
  const g = option ? quantity * option.grams : quantity
  return g > 0 && g <= MAX_GRAMS ? g : null
}

interface CorpusPortionRow {
  measure_unit: string | null
  modifier: string | null
  amount: number | null
  gram_weight: number
}

interface ServingRow {
  serving_size_g: number | null
  serving_desc: string | null
}

export async function loadPortionOptions(
  nutritionDb: DbAdapter,
  userDb: DbAdapter | null,
  food: { foodId: string | number; name: string },
): Promise<PortionOption[]> {
  const foodId = Number(food.foodId)
  const out: PortionOption[] = []
  const seen = new Set<string>()
  const push = (o: PortionOption) => {
    const key = o.label.toLowerCase()
    if (seen.has(key) || !(o.grams > 0) || o.grams > MAX_UNIT_GRAMS) return
    seen.add(key)
    out.push(o)
  }

  if (userDb) {
    try {
      const rows = await userDb.all<{ label: string; grams: number }>(
        'SELECT label, grams FROM user_portions WHERE food_name = ? ORDER BY created_at',
        [food.name],
      )
      for (const r of rows) push({ id: `user:${r.label}`, label: r.label, grams: r.grams, source: 'user' })
    } catch {
      // A user db without the table yet must not break picking a food.
    }
  }

  const serving = await nutritionDb.get<ServingRow>('SELECT serving_size_g, serving_desc FROM foods WHERE id = ?', [foodId])
  if (serving?.serving_size_g != null && serving.serving_size_g > 0) {
    const desc = (serving.serving_desc ?? '').trim()
    push({ id: 'serving', label: desc !== '' ? desc : 'porcja', grams: serving.serving_size_g, source: 'corpus' })
  }

  const portions = await nutritionDb.all<CorpusPortionRow>(
    `SELECT measure_unit, modifier, amount, gram_weight FROM food_portions
     WHERE food_id = ? ORDER BY is_fndds_default DESC, id LIMIT ?`,
    [foodId, MAX_CORPUS_OPTIONS],
  )
  for (const p of portions) {
    // Portion rows store the weight of `amount` units, so the label keeps the amount.
    push({ id: `corpus:${p.measure_unit}:${p.modifier}:${p.amount}`, label: portionLabel(p.amount, p.measure_unit, p.modifier), grams: p.gram_weight, source: 'corpus' })
  }
  return out
}

/** Remember "1 <label> = <grams> g" for a product. Null when the input is not usable. */
export async function saveUserPortion(
  userDb: DbAdapter,
  foodName: string,
  rawLabel: string,
  grams: number,
  now: number,
): Promise<PortionOption | null> {
  const label = rawLabel.trim().replace(/\s+/g, ' ')
  if (label === '' || label.length > 30 || !(grams > 0) || grams > MAX_UNIT_GRAMS) return null
  await userDb.run(
    'INSERT OR REPLACE INTO user_portions (food_name, label, grams, created_at) VALUES (?,?,?,?)',
    [foodName, label, grams, now],
  )
  return { id: `user:${label}`, label, grams, source: 'user' }
}
