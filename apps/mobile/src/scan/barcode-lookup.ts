/**
 * Barcode helpers for startBarcodeScan: a brand-aware display name and the Open
 * Food Facts (OFF) product API as a second chance before the web-search model.
 *
 * Pure on purpose (no Expo imports) so it runs under vitest.
 *
 * Why an OFF API fallback exists: the bundled snapshot only holds products tagged
 * `en:poland` with complete macros. A product sold in Poland but tagged for another
 * country is missing locally, and the only remaining fallback was a Gemini web
 * search that is unreliable and hits free-tier limits (HTTP 429).
 *
 * OFF usage terms: one API call per real user scan, with an identifying
 * User-Agent. startBarcodeScan calls this once per scan and never in a loop.
 * The request carries only the barcode digits (and the device IP, as any request).
 *
 * The parser reads the `_100g` keys of `nutriments`; the shape was confirmed
 * against a live response for GTIN 7622200007332.
 */

export interface OffNutrients {
  kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  fiber_g: number | null
  sugar_g: number | null
  sodium_mg: number | null
}

export interface OffProduct {
  name: string
  brand: string | null
  servingG: number | null
  nutrients: OffNutrients
}

const ENTITIES: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' }

export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** "Strawberry" + brand "Milka" reads as "Milka Strawberry"; a name already containing the brand is left alone. */
export function displayNameWithBrand(brand: string | null | undefined, name: string): string {
  const n = name.trim()
  const b = (brand ?? '').trim()
  if (b === '' || n.toLowerCase().includes(b.toLowerCase())) return n
  return `${b} ${n}`
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function inRange(v: number | null, lo: number, hi: number): boolean {
  return v == null || (v >= lo && v <= hi)
}

/**
 * Turns an OFF API response into a product, or null when the product is absent or
 * its numbers are unusable. The gates mirror the ones applied to the bundled
 * snapshot, so a product behaves the same whether it came from disk or the API.
 */
export function parseOffProduct(json: unknown): OffProduct | null {
  if (typeof json !== 'object' || json === null) return null
  const root = json as Record<string, unknown>
  if (root.status !== 1) return null
  const prod = root.product
  if (typeof prod !== 'object' || prod === null) return null
  const p = prod as Record<string, unknown>
  const nut = (typeof p.nutriments === 'object' && p.nutriments !== null ? p.nutriments : {}) as Record<string, unknown>

  const kj = num(nut['energy-kj_100g']) ?? num(nut['energy_100g'])
  const kcal = num(nut['energy-kcal_100g']) ?? (kj != null ? kj / 4.184 : null)
  const protein = num(nut['proteins_100g'])
  const fat = num(nut['fat_100g'])
  const carbs = num(nut['carbohydrates_100g'])
  if (kcal == null || protein == null || fat == null || carbs == null) return null

  const fiber = num(nut['fiber_100g'])
  const sugar = num(nut['sugars_100g'])
  const sodiumG = num(nut['sodium_100g'])
  const saltG = num(nut['salt_100g'])
  const sodiumMg = sodiumG != null ? sodiumG * 1000 : saltG != null ? (saltG / 2.5) * 1000 : null
  // OFF stores alcohol in % vol; 1 % vol is about 0.789 g of ethanol per 100 ml.
  const alcoholPct = num(nut['alcohol_100g']) ?? 0
  const alcoholG = alcoholPct * 0.789

  if (kcal < 0 || kcal > 900) return null
  if (!inRange(protein, 0, 100) || !inRange(fat, 0, 100) || !inRange(carbs, 0, 100)) return null
  if (protein + fat + carbs > 105) return null
  if (!inRange(sugar, 0, 100) || !inRange(fiber, 0, 100)) return null
  const atwater = 4 * protein + 4 * carbs + 9 * fat + 7 * alcoholG
  if (atwater >= 20 && (kcal < 0.6 * atwater || kcal > 1.4 * atwater)) return null

  const brandRaw = typeof p.brands === 'string' ? unescapeHtml(p.brands.split(',')[0]!.trim()) : ''
  const brand = brandRaw === '' ? null : brandRaw

  const nameRaw = [p.product_name_pl, p.product_name].find((v): v is string => typeof v === 'string' && v.trim().length >= 2)
  const name = nameRaw ? unescapeHtml(nameRaw.trim()) : (brand ?? 'Produkt z kodem kreskowym')

  const serving = num(p.serving_quantity)
  return {
    name,
    brand,
    servingG: serving != null && serving > 0 && serving <= 2000 ? serving : null,
    nutrients: {
      kcal,
      protein_g: protein,
      fat_g: fat,
      carbs_g: carbs,
      fiber_g: fiber,
      sugar_g: sugar,
      sodium_mg: sodiumMg,
    },
  }
}

const OFF_ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product'
const OFF_FIELDS = 'code,product_name,product_name_pl,brands,nutriments,serving_quantity,nutrition_data_per'
const OFF_USER_AGENT = 'NutAI-PL/0.1 (https://github.com/hamsterrooo/nut-ai)'

export interface FetchOffOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** One lookup. Any failure (offline, timeout, HTTP error, bad JSON) is null: the caller moves on to its next fallback. */
export async function fetchOffProduct(gtin: string, opts: FetchOffOptions = {}): Promise<OffProduct | null> {
  if (!/^\d{8,14}$/.test(gtin)) return null
  const fetchImpl = opts.fetchImpl ?? fetch
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000)
  try {
    const res = await fetchImpl(`${OFF_ENDPOINT}/${gtin}.json?fields=${OFF_FIELDS}`, {
      headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    return parseOffProduct(await res.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
