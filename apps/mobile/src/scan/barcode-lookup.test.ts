import { describe, expect, it } from 'vitest'
import { displayNameWithBrand, fetchOffProduct, parseOffProduct, unescapeHtml } from './barcode-lookup'

// Real response for GTIN 7622200007332 (trimmed to the keys the parser reads plus a few neighbours).
const MILKA = {
  code: '7622200007332',
  product: {
    brands: 'Milka',
    code: '7622200007332',
    nutriments: {
      carbohydrates_100g: 55,
      energy: 2287.5,
      'energy-kcal': 560,
      'energy-kcal_100g': 560,
      'energy-kj_100g': 2287.5,
      energy_100g: 2287.5,
      fat_100g: 34.5,
      fiber_100g: 1,
      proteins_100g: 4,
      salt_100g: 0.25,
      'saturated-fat_100g': 19.5,
      sodium_100g: 0.1,
      sugars_100g: 55,
    },
    nutrition_data_per: '100g',
    product_name: 'Chocolate de leite dos Alpes Strawberry',
    serving_quantity: 20,
  },
  status: 1,
  status_verbose: 'product found',
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

describe('parseOffProduct', () => {
  it('reads the real Milka response', () => {
    const p = parseOffProduct(MILKA)!
    expect(p.name).toBe('Chocolate de leite dos Alpes Strawberry')
    expect(p.brand).toBe('Milka')
    expect(p.servingG).toBe(20)
    expect(p.nutrients).toEqual({
      kcal: 560, protein_g: 4, fat_g: 34.5, carbs_g: 55, fiber_g: 1, sugar_g: 55, sodium_mg: 100,
    })
  })

  it('prefers the Polish name when present', () => {
    const j = clone(MILKA) as any
    j.product.product_name_pl = 'Czekolada mleczna truskawkowa'
    expect(parseOffProduct(j)!.name).toBe('Czekolada mleczna truskawkowa')
  })

  it('returns null for an unknown product', () => {
    expect(parseOffProduct({ code: '1', status: 0, status_verbose: 'product not found' })).toBeNull()
    expect(parseOffProduct(null)).toBeNull()
    expect(parseOffProduct('x')).toBeNull()
  })

  it('returns null when a macro is missing', () => {
    const j = clone(MILKA) as any
    delete j.product.nutriments.proteins_100g
    expect(parseOffProduct(j)).toBeNull()
  })

  it('falls back to kJ when kcal is missing', () => {
    const j = clone(MILKA) as any
    delete j.product.nutriments['energy-kcal_100g']
    expect(parseOffProduct(j)!.nutrients.kcal).toBeCloseTo(2287.5 / 4.184, 5)
  })

  it('derives sodium from salt when sodium is missing', () => {
    const j = clone(MILKA) as any
    delete j.product.nutriments.sodium_100g
    expect(parseOffProduct(j)!.nutrients.sodium_mg).toBeCloseTo(100, 5)
  })

  it('rejects impossible values', () => {
    const tooMuch = clone(MILKA) as any
    tooMuch.product.nutriments.fat_100g = 150
    expect(parseOffProduct(tooMuch)).toBeNull()
    const bigKcal = clone(MILKA) as any
    bigKcal.product.nutriments['energy-kcal_100g'] = 1500
    expect(parseOffProduct(bigKcal)).toBeNull()
  })

  it('rejects kcal that contradict the macros, but allows for alcohol', () => {
    const wrong = clone(MILKA) as any
    wrong.product.nutriments['energy-kcal_100g'] = 100
    expect(parseOffProduct(wrong)).toBeNull()

    const beer = {
      status: 1,
      product: {
        product_name: 'Piwo jasne',
        nutriments: {
          'energy-kcal_100g': 43, proteins_100g: 0.4, fat_100g: 0, carbohydrates_100g: 3, alcohol_100g: 5,
        },
      },
    }
    expect(parseOffProduct(beer)!.nutrients.kcal).toBe(43)
  })

  it('ignores a nonsense serving size and unescapes names', () => {
    const j = clone(MILKA) as any
    j.product.serving_quantity = '0'
    j.product.product_name = 'Bier &quot;Tyskie&quot;'
    const p = parseOffProduct(j)!
    expect(p.servingG).toBeNull()
    expect(p.name).toBe('Bier "Tyskie"')
  })

  it('takes the first brand of a list and names an unnamed product after it', () => {
    const j = clone(MILKA) as any
    j.product.brands = 'Milka, Mondelez'
    delete j.product.product_name
    const p = parseOffProduct(j)!
    expect(p.brand).toBe('Milka')
    expect(p.name).toBe('Milka')
  })
})

describe('displayNameWithBrand', () => {
  it('prepends a missing brand', () => {
    expect(displayNameWithBrand('Milka', 'Strawberry')).toBe('Milka Strawberry')
  })
  it('does not repeat a brand already in the name, whatever the case', () => {
    expect(displayNameWithBrand('Milka', 'Milka MMMAX Strawberry Cheesecake')).toBe('Milka MMMAX Strawberry Cheesecake')
    expect(displayNameWithBrand('winiary', 'Zupa Winiary')).toBe('Zupa Winiary')
  })
  it('handles no brand', () => {
    expect(displayNameWithBrand(null, ' Gouda ')).toBe('Gouda')
    expect(displayNameWithBrand('', 'Gouda')).toBe('Gouda')
  })
})

describe('unescapeHtml', () => {
  it('decodes named and numeric entities and leaves unknown ones', () => {
    expect(unescapeHtml('I&lt;3vege &amp; &#322;&#x142; &bogus;')).toBe('I<3vege & łł &bogus;')
  })
})

describe('fetchOffProduct', () => {
  const okResponse = (body: unknown, ok = true) => ({ ok, json: async () => body }) as unknown as Response

  it('returns a parsed product and sends the identifying request', async () => {
    let url = ''
    let ua = ''
    const fetchImpl = (async (u: string, init?: RequestInit) => {
      url = u
      ua = (init?.headers as Record<string, string>)['User-Agent']!
      return okResponse(MILKA)
    }) as unknown as typeof fetch
    const p = await fetchOffProduct('7622200007332', { fetchImpl })
    expect(p!.brand).toBe('Milka')
    expect(url).toContain('/api/v2/product/7622200007332.json?fields=')
    expect(url).toContain('nutriments')
    expect(ua).toMatch(/^NutAI-PL\//)
  })

  it('returns null on HTTP errors, thrown errors and bad JSON', async () => {
    expect(await fetchOffProduct('7622200007332', { fetchImpl: (async () => okResponse({}, false)) as unknown as typeof fetch })).toBeNull()
    expect(await fetchOffProduct('7622200007332', { fetchImpl: (async () => { throw new Error('offline') }) as unknown as typeof fetch })).toBeNull()
    expect(await fetchOffProduct('7622200007332', { fetchImpl: (async () => ({ ok: true, json: async () => { throw new Error('bad') } })) as unknown as typeof fetch })).toBeNull()
  })

  it('gives up after the timeout', async () => {
    const fetchImpl = ((_: string, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch
    expect(await fetchOffProduct('7622200007332', { fetchImpl, timeoutMs: 20 })).toBeNull()
  })

  it('never calls the network for a malformed code', async () => {
    let called = false
    const fetchImpl = (async () => { called = true; return okResponse(MILKA) }) as unknown as typeof fetch
    expect(await fetchOffProduct('abc', { fetchImpl })).toBeNull()
    expect(await fetchOffProduct('123', { fetchImpl })).toBeNull()
    expect(called).toBe(false)
  })
})
