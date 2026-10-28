import * as ImageManipulator from 'expo-image-manipulator'
import { SEEDED_BASELINES, type Band } from '@nutai/confidence'
import {
  LabelPayloadZ,
  VISION_WIRE_SCHEMA,
  VisionPayloadZ,
  WebLookupResultZ,
  type IngredientRow,
  type LoggedMeal,
} from '@nutai/core-schema'
import type { PersonalPriors } from '@nutai/gram-engine'
import {
  anthropicWireSchema,
  geminiWireSchema,
  openAiWireSchema,
  LABEL_SCAN_PROMPT_VERSION,
  type ProviderId,
} from '@nutai/prompt'
import { recomputeAfterEdit, runPipeline, validatePayload, type ScanResult } from '@nutai/pipeline'
import { stampSchemaVersion } from './stamp-schema-version'
import { openNutritionDb } from '../db/expo-adapter'
import { loadFoodDb } from '../db/portions'
import { runLabelScan, runScanWithFallback, runWebLookup, type ScanFailure, type WebLookupOutcome } from '../inference/pathA/client'
import { resolveInference, type ResolveFailure, type Resolved } from '../inference/resolve'
import { applyWebOption, getPhase, setPhase, setWebLookup } from './store'
import { displayNameWithBrand, lookupOffProduct } from './barcode-lookup'

/**
 * The scan orchestrator — capture in, ready-to-review meal out.
 *
 * This file is the reason the shutter can navigate IMMEDIATELY: everything
 * here runs behind the result screen's progress states, and every exit is a
 * named phase — never a silent dead end. The sequence:
 *
 *   preparing    resize + EXIF-bake + base64 (local, fast)
 *   identifying  the one model call — the only stage that owns wall-clock time
 *   matching     the deterministic pipeline against the bundled USDA corpus
 *   ready        review screen, editable rows
 *   (background) web-search refinement for items the corpus missed
 *
 * D16 note: the refinement stage transcribes published nutrition facts with a
 * source URL. It replaces AI-estimate rows — the weakest rows on the screen —
 * with cited label data, and never touches a row the database already matched.
 */

const EMPTY_PRIORS: PersonalPriors = { get: () => null, containers: new Map() }

/** Kept for retry, so a network blip does not re-run image preprocessing. */
let lastCapture: { photoUri: string; base64: string } | null = null
/** What "Spróbuj ponownie" repeats. Without this a failed label retried as a meal photo. */
let lastRetry: { kind: 'scan' | 'label'; photoUri: string } | { kind: 'barcode'; gtin: string } = { kind: 'scan', photoUri: '' }

const HEADLINE = {
  label: 'Nie udało się odczytać etykiety',
  barcode: 'Nie znaleziono produktu',
} as const

function wireSchemaFor(provider: ProviderId): Record<string, unknown> {
  if (provider === 'anthropic') return anthropicWireSchema(VISION_WIRE_SCHEMA)
  if (provider === 'openai') return openAiWireSchema(VISION_WIRE_SCHEMA)
  return geminiWireSchema(VISION_WIRE_SCHEMA)
}

/**
 * Inline base64 stays under 1 MB: no vendor
 * needs more for a 1024-px meal photo. A 1024-px JPEG at q0.8 is ~200–600 KB;
 * the steps below only run on an unusually busy frame.
 */
const MAX_INLINE_BASE64_BYTES = 1_000_000
const JPEG_QUALITY_STEPS = [0.8, 0.6, 0.45] as const

async function preprocess(photoUri: string): Promise<string> {
  let base64: string | null = null
  for (const compress of JPEG_QUALITY_STEPS) {
    const ctx = ImageManipulator.ImageManipulator.manipulate(photoUri)
    // Resize BEFORE encoding — the order is what bounds memory, not the format.
    ctx.resize({ width: 1024 })
    const image = await ctx.renderAsync()
    const saved = await image.saveAsync({
      compress,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    })
    if (!saved.base64) throw new Error('preprocess produced no base64')
    base64 = saved.base64
    if (base64.length <= MAX_INLINE_BASE64_BYTES) break
  }
  return base64!
}

/** The copy for "nothing to scan with", per feature. */
/** The failure screen's copyable code: the HTTP status when there is one, else the failure kind. */
function codeProp(err: ScanFailure | undefined): { code: string } | Record<string, never> {
  if (!err) return {}
  return { code: err.httpStatus ? String(err.httpStatus) : err.kind }
}

function resolveFailureCopy(err: ResolveFailure, feature: 'scan' | 'label'): { message: string; failureKind: 'no-key' | 'key-invalid' } {
  if (err.kind === 'key-missing') return { message: 'Brak zapisanego klucza. Wpisz go ponownie w Profilu.', failureKind: 'key-invalid' }
  const base =
    feature === 'scan'
      ? 'Skanowanie zdjęć wymaga klucza API. Dodaj go w Profilu. Kod kreskowy, wyszukiwanie i ręczne dodawanie działają bez niego.'
      : feature === 'label'
        ? 'Odczyt etykiety wymaga klucza API. Dodaj go w Profilu albo znajdź produkt po kodzie kreskowym lub w wyszukiwarce.'
        : 'Odczyt paragonu wymaga klucza API. Dodaj go w Profilu.'
  return { message: base, failureKind: 'no-key' }
}

/**
 * Web lookup is OFF. It rides on Gemini's Google Search grounding, which the
 * free tier does not include (limit 0, so every call is a 429). Callers already
 * treat a failed lookup as "no match", so the answer is a local failure with no
 * request. Flip to true only on a billed key.
 */
const WEB_LOOKUP_ENABLED = false

async function webLookup(r: Resolved, input: { itemName: string; brand: string | null; visualContext?: string | null }): Promise<WebLookupOutcome> {
  if (!WEB_LOOKUP_ENABLED) {
    return { ok: false, error: { kind: 'model-unavailable', message: 'Wyszukiwanie w sieci jest wyłączone.', retryable: false } }
  }
  return runWebLookup(r.dialect, { model: r.textModel, ...input }, r.credential)
}

export async function startScan(photoUri: string): Promise<void> {
  lastRetry = { kind: 'scan', photoUri }
  setPhase({ kind: 'analyzing', photoUri, stage: 'preparing' })

  let base64: string
  try {
    base64 = await preprocess(photoUri)
  } catch {
    setPhase({
      kind: 'failed',
      photoUri,
      message: 'Nie udało się odczytać zdjęcia. Zrób je ponownie.',
      canRetry: false,
    })
    return
  }

  lastCapture = { photoUri, base64 }
  await analyze(photoUri, base64)
}

export async function retryScan(): Promise<void> {
  if (lastRetry.kind === 'barcode') return startBarcodeScan(lastRetry.gtin)
  if (lastRetry.kind === 'label') return startLabelScan(lastRetry.photoUri)
  if (!lastCapture) return
  const { photoUri, base64 } = lastCapture
  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })
  await analyze(photoUri, base64)
}

interface AnalyzeOpts {
  /** Prepended context for a Fix Result pass. */
  fixBlock?: string
  /** Prior scan's meta, so the ledger bills one meal for both calls. */
  priorMeta?: { inputTokens: number; outputTokens: number; costUsd: number } | null
  /** Portion fraction to carry across a fix — user answers survive re-analysis. */
  keepFraction?: number
}

async function analyze(photoUri: string, base64: string, opts: AnalyzeOpts = {}): Promise<void> {
  const resolved = await resolveInference()
  if (!resolved.ok) {
    setPhase({ kind: 'failed', photoUri, canRetry: false, ...resolveFailureCopy(resolved.error, 'scan') })
    return
  }
  const r = resolved.value

  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })
  const outcome = await runScanWithFallback({
    provider: r.dialect,
    model: r.model,
    credential: r.credential,
    imagesBase64: [base64],
    localSignalsBlock: opts.fixBlock ?? '',
    jsonSchema: wireSchemaFor(r.dialect),
  })

  if (!outcome.ok) {
    setPhase({
      kind: 'failed',
      photoUri,
      message: outcome.error.message,
      canRetry: outcome.error.retryable,
      failureKind: outcome.error.kind,
      ...codeProp(outcome.error),
    })
    return
  }

  setPhase({ kind: 'analyzing', photoUri, stage: 'matching' })

  const rawPayload = stampSchemaVersion(outcome.value.raw)
  let result: ScanResult | null = null
  let pipelineError = ''
  try {
    const nutritionDb = await openNutritionDb()
    const foodDb = await loadFoodDb(nutritionDb)
    result = await runPipeline(
      rawPayload,
      {
        db: nutritionDb,
        priors: EMPTY_PRIORS,
        baselines: SEEDED_BASELINES,
        path: 'cloud',
        now: Date.now(),
      },
      foodDb,
    )
  } catch (e) {
    result = null
    const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    pipelineError = raw.replace(/\s+/g, ' ').slice(0, 400)
    console.warn('[scan] pipeline failed', e)
  }

  if (!result && !pipelineError) {
    // runPipeline returns null (no throw) when the model's JSON fails the
    // VisionPayloadZ check. Re-run the check here to surface the reason.
    const check = VisionPayloadZ.safeParse(rawPayload)
    if (!check.success) {
      pipelineError = check.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')
        .slice(0, 400)
    } else {
      pipelineError = 'Walidacja schematu przeszła, ale pipeline zwrócił pusty wynik.'
    }
    console.warn('[scan] schema violation', JSON.stringify(rawPayload)?.slice(0, 2000))
  }

  if (!result) {
    setPhase({
      kind: 'failed',
      photoUri,
      message:
        'Model odpowiedział w formie, której nie dało się użyć. To nasza wina, spróbuj jeszcze raz.' +
        (pipelineError ? `\n\nSzczegóły: ${pipelineError}` : ''),
      canRetry: true,
      failureKind: 'schema-violation',
      code: 'SCHEMA',
    })
    return
  }

  if (!result.isFood) {
    setPhase({
      kind: 'failed',
      photoUri,
      message: result.refusalReason || 'To zdjęcie nie wygląda na jedzenie.',
      canRetry: false,
    })
    return
  }

  if (opts.keepFraction != null && opts.keepFraction !== 1) {
    result.meal.portionEatenFraction = opts.keepFraction
    const re = recomputeAfterEdit(result.meal, result.items.map((i) => i.band))
    result = { ...result, totals: re.totals, mealBand: re.mealBand }
  }

  setPhase({
    kind: 'ready',
    photoUri,
    result,
    bands: result.items.map((i) => i.band),
    meta: {
      provider: r.selected,
      model: r.model,
      inputTokens: outcome.value.inputTokens + (opts.priorMeta?.inputTokens ?? 0),
      outputTokens: outcome.value.outputTokens + (opts.priorMeta?.outputTokens ?? 0),
      costUsd: outcome.value.costUsd + (opts.priorMeta?.costUsd ?? 0),
      promptVersion: outcome.value.promptVersion,
    },
    webLookups: {},
  })

  // Fire-and-forget: refinement upgrades rows underneath the review screen.
  void refineMisses(result, rawPayload, r)
}

/** How many corpus misses we will pay to look up per scan. */
const MAX_LOOKUPS_PER_SCAN = 2

/**
 * Background refinement: every item the corpus missed gets one shot at being
 * upgraded from "AI estimate" to "transcribed from the brand's published
 * nutrition facts". One option auto-applies; several become a question card.
 */
async function refineMisses(result: ScanResult, rawPayload: unknown, r: Resolved): Promise<void> {
  const payload = validatePayload(rawPayload)
  // Two triggers: the corpus missed entirely, or the model saw a BRAND (a logo
  // counts — golden arches on the wrapper). A branded item that matched some
  // generic corpus row still deserves the brand's own published numbers.
  const misses = result.items
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item, index }) =>
        item.resolution === 'miss' || payload?.items[index]?.brand != null,
    )
    .slice(0, MAX_LOOKUPS_PER_SCAN)

  await Promise.all(
    misses.map(async ({ item, index }) => {
      const rowId = item.row.id
      setWebLookup(rowId, { status: 'running' })

      const source = payload?.items[index]
      const lookup = await webLookup(r, {
        itemName: source?.name ?? item.row.displayName,
        brand: source?.brand ?? null,
        visualContext: source?.legible_label_text ?? null,
      })

      if (!lookup.ok) {
        setWebLookup(rowId, { status: 'failed' })
        return
      }
      const parsed = WebLookupResultZ.safeParse(lookup.raw)
      if (!parsed.success || !parsed.data.found || parsed.data.options.length === 0) {
        setWebLookup(rowId, { status: 'failed' })
        return
      }

      setWebLookup(rowId, { status: 'done', result: parsed.data })
      // Unambiguous single match: apply it. The row visibly upgrades from
      // amber AI-estimate to a cited source — that is the payoff moment.
      if (parsed.data.options.length === 1 && !parsed.data.question) {
        applyWebOption(rowId, parsed.data.options[0]!, parsed.data.source_url)
      }
    }),
  )
}

/**
 * Fix Result — free-text correction with a minimal-delta contract.
 *
 * The re-analysis is seeded with the CURRENT ingredient state (including every
 * edit the user already made), and the instruction is explicit that items the
 * correction does not implicate must come back byte-identical. This is what
 * prevents the incumbent's canonical failure: re-analysis that deletes the
 * corrections you already made. Cost is merged so the ledger bills one meal.
 */
export async function fixScan(note: string): Promise<void> {
  const phase = getPhase()
  if (phase.kind !== 'ready' || !lastCapture) return

  const rows = phase.result.meal.ingredients
    .map((r) => `- ${r.displayName}: ${Math.round(r.grams)} g`)
    .join('\n')
  const fixBlock = [
    'FIX REQUEST — the user reviewed your previous analysis of this exact photo and asked for a correction.',
    'The currently accepted analysis:',
    rows,
    `The user's correction: "${note.trim()}"`,
    'Re-emit the FULL JSON payload with ONLY the changes the correction requires.',
    'Every item and gram figure the correction does not implicate must return IDENTICAL to the accepted analysis above — do not re-estimate what the user did not question.',
  ].join('\n')

  const keepFraction = phase.result.meal.portionEatenFraction
  const priorMeta = phase.meta
  const photoUri = phase.photoUri ?? lastCapture.photoUri

  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })
  await analyze(photoUri, lastCapture.base64, { fixBlock, priorMeta, keepFraction })
}

// ---------------------------------------------------------------------------
// Barcode and label — the zero-and-near-zero-cost paths
// ---------------------------------------------------------------------------

/**
 * Build a ready phase from rows whose numbers came off a package — a barcode
 * row or a transcribed label. No model grams, no repair questions: the printed
 * serving IS the portion, and the only remaining uncertainty is label rounding.
 */
function readyFromRows(
  rows: IngredientRow[],
  photoUri: string | null,
  engineId: string,
  promptVersion: string | null,
  webLookups: Record<string, import('./store').WebLookupState> = {},
): void {
  const meal: LoggedMeal = {
    id: `meal_${Date.now()}`,
    loggedAt: new Date().toISOString(),
    ingredients: rows,
    portionEatenFraction: 1,
    engineId,
    promptVersion,
    schemaVersion: null,
    clampFlags: [],
  }
  const bands: Band[] = rows.map((r) => ({
    halfPct: r.bandHalfPct,
    tier: 'tight',
    reasons: [
      r.origin === 'label_ocr'
        ? 'Przepisano z wydrukowanej etykiety wartości odżywczych'
        : r.origin === 'web_lookup'
          ? 'Przepisano z opublikowanych wartości odżywczych'
          : 'Dopasowano po kodzie kreskowym do produktu z etykiety',
    ],
  }))
  const { totals, mealBand } = recomputeAfterEdit(meal, bands)
  const result: ScanResult = {
    isFood: true,
    refusalReason: null,
    items: rows.map((row, i) => ({
      row,
      band: bands[i]!,
      resolution: 'barcode',
      gramPathway: row.gramPathway,
    })),
    meal,
    totals,
    mealBand,
    questions: [],
    clampFlags: [],
    zeroHitCount: 0,
  }
  setPhase({ kind: 'ready', photoUri, result, bands, meta: null, webLookups })
}

interface BarcodeFoodRow {
  id: number
  name: string
  brand: string | null
  serving_size_g: number | null
  energy_kcal: number | null
  protein_g: number | null
  fat_g: number | null
  carb_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  sodium_mg: number | null
}

/**
 * Barcode: corpus GTIN hit costs NOTHING — no model call, no network. A miss
 * tries Open Food Facts once, then points at the label scanner.
 */
export async function startBarcodeScan(gtin: string): Promise<void> {
  lastRetry = { kind: 'barcode', gtin }
  setPhase({ kind: 'analyzing', photoUri: '', stage: 'matching' })

  let food: BarcodeFoodRow | null = null
  try {
    const ndb = await openNutritionDb()
    food = await ndb.get<BarcodeFoodRow>(
      `SELECT f.id, f.name, b.canonical_name AS brand, f.serving_size_g, f.energy_kcal, f.protein_g,
              f.fat_g, f.carb_g, f.fiber_g, f.sugar_g, f.sodium_mg
       FROM foods f LEFT JOIN brands b ON b.id = f.brand_id
       WHERE f.barcode = ? LIMIT 1`,
      [gtin],
    )
  } catch {
    food = null
  }

  if (food && food.energy_kcal != null) {
    const grams = food.serving_size_g ?? 100
    readyFromRows(
      [
        {
          id: `row_${Date.now()}`,
          displayName: displayNameWithBrand(food.brand, food.name),
          sourceFoodId: String(food.id),
          grams,
          nutrientSnapshot: {
            kcal: food.energy_kcal,
            protein_g: food.protein_g ?? 0,
            fat_g: food.fat_g ?? 0,
            carbs_g: food.carb_g ?? 0,
            fiber_g: food.fiber_g,
            sugar_g: food.sugar_g,
            sodium_mg: food.sodium_mg,
          },
          origin: 'barcode',
          gramPathway: 'packaged_exact',
          bandHalfPct: 0.05,
          isEstimate: false,
          assumptions: [],
        },
      ],
      null,
      'barcode-local',
      null,
    )
    return
  }

  // Not in the bundled snapshot. Open Food Facts by barcode comes first: it needs
  // no key, has no model in the loop and covers products the snapshot filtered out.
  const lookup = await lookupOffProduct(gtin)
  if (lookup.kind === 'found') {
    const off = lookup.product
    readyFromRows(
      [
        {
          id: `row_${Date.now()}`,
          displayName: displayNameWithBrand(off.brand, off.name),
          sourceFoodId: null,
          grams: off.servingG ?? 100,
          nutrientSnapshot: {
            kcal: off.nutrients.kcal,
            protein_g: off.nutrients.protein_g,
            fat_g: off.nutrients.fat_g,
            carbs_g: off.nutrients.carbs_g,
            fiber_g: off.nutrients.fiber_g,
            sugar_g: off.nutrients.sugar_g,
            sodium_mg: off.nutrients.sodium_mg,
          },
          origin: 'barcode',
          gramPathway: 'packaged_exact',
          bandHalfPct: 0.05,
          isEstimate: false,
          assumptions: [],
        },
      ],
      null,
      'barcode-off',
      null,
    )
    return
  }

  // Not in the snapshot and no usable OFF product. The label scanner reads the
  // printed table with a plain vision call, which the free tier allows. A network
  // failure is a different case: the code may well be in OFF, so retry comes first.
  if (lookup.kind === 'network') {
    setPhase({
      kind: 'failed',
      photoUri: '',
      headline: HEADLINE.barcode,
      message: 'Nie udało się sprawdzić kodu w Open Food Facts: brak sieci albo serwer nie odpowiada. Spróbuj ponownie. Jeśli kod nadal nie przejdzie, użyj trybu Etykieta.',
      canRetry: true,
      offerLabel: true,
    })
    return
  }
  setPhase({
    kind: 'failed',
    photoUri: '',
    headline: HEADLINE.barcode,
    message:
      lookup.kind === 'unusable'
        ? 'Ten produkt jest w Open Food Facts, ale bez kompletnych wartości odżywczych. Zrób zdjęcie tabeli wartości odżywczych na opakowaniu.'
        : 'Tego kodu kreskowego nie ma we wbudowanej bazie ani w Open Food Facts. Zrób zdjęcie tabeli wartości odżywczych na opakowaniu.',
    canRetry: false,
    offerLabel: true,
  })
}

/**
 * Label scanner: photograph the printed panel, transcribe it, log it as a
 * packaged_exact row. A label with no printed gram weight fails LOUDLY — a
 * guessed serving weight under a 'packaged_exact' pathway would be a lie in
 * the one place the app promises exactness.
 */
export async function startLabelScan(photoUri: string): Promise<void> {
  lastRetry = { kind: 'label', photoUri }
  setPhase({ kind: 'analyzing', photoUri, stage: 'preparing' })

  let base64: string
  try {
    base64 = await preprocess(photoUri)
  } catch {
    setPhase({ kind: 'failed', photoUri, headline: HEADLINE.label, message: 'Nie udało się odczytać zdjęcia. Zrób je ponownie.', canRetry: false })
    return
  }
  lastCapture = { photoUri, base64 }

  const resolved = await resolveInference()
  if (!resolved.ok) {
    setPhase({ kind: 'failed', photoUri, headline: HEADLINE.label, canRetry: false, ...resolveFailureCopy(resolved.error, 'label') })
    return
  }
  const r = resolved.value
  setPhase({ kind: 'analyzing', photoUri, stage: 'identifying' })

  const outcome = await runLabelScan(r.dialect, { model: r.model, imageBase64: base64 }, r.credential)
  if (!outcome.ok) {
    setPhase({
      kind: 'failed',
      photoUri,
      headline: HEADLINE.label,
      message: outcome.error ? outcome.error.message : 'Nie udało się odczytać etykiety.',
      canRetry: outcome.error?.retryable ?? false,
      failureKind: outcome.error?.kind,
      ...codeProp(outcome.error),
    })
    return
  }

  const parsed = LabelPayloadZ.safeParse(outcome.raw)
  if (!parsed.success || parsed.data.per_serving.calories_kcal <= 0) {
    setPhase({
      kind: 'failed',
      photoUri,
      headline: HEADLINE.label,
      message: 'To nie wygląda na czytelną etykietę wartości odżywczych. Ułóż całą tabelę w kadrze, płasko i przy dobrym świetle.',
      canRetry: true,
    })
    return
  }
  if (parsed.data.serving_g == null) {
    setPhase({
      kind: 'failed',
      photoUri,
      headline: HEADLINE.label,
      message: 'Etykietę odczytano, ale nie podaje masy porcji w gramach, a bez niej liczb nie da się uczciwie przeskalować. Jeśli jest linia z wielkością porcji lub kolumna na 100 g, ujmij ją na zdjęciu.',
      canRetry: true,
    })
    return
  }

  const label = parsed.data
  const grams = label.serving_g!
  const per100 = 100 / grams
  const p = label.per_serving
  readyFromRows(
    [
      {
        id: `row_${Date.now()}`,
        displayName: label.product_name ?? 'Labeled item',
        sourceFoodId: null,
        grams,
        nutrientSnapshot: {
          kcal: p.calories_kcal * per100,
          protein_g: p.protein_g * per100,
          fat_g: p.fat_g * per100,
          carbs_g: p.carbs_g * per100,
          fiber_g: p.fiber_g == null ? null : p.fiber_g * per100,
          sugar_g: p.sugar_g == null ? null : p.sugar_g * per100,
          sodium_mg: p.sodium_mg == null ? null : p.sodium_mg * per100,
        },
        origin: 'label_ocr',
        gramPathway: 'packaged_exact',
        bandHalfPct: 0.05,
        isEstimate: false,
        assumptions: [],
      },
    ],
    photoUri,
    'label-scan',
    LABEL_SCAN_PROMPT_VERSION,
  )
}

/**
 * Free-text "Other" answer on a question card: one more search, seeded with
 * what the user typed.
 */
export async function lookupOther(rowId: string, typed: string): Promise<void> {
  const resolved = await resolveInference()
  if (!resolved.ok) return
  const r = resolved.value

  setWebLookup(rowId, { status: 'running' })
  const lookup = await webLookup(r, { itemName: typed, brand: null })
  if (!lookup.ok) {
    setWebLookup(rowId, { status: 'failed' })
    return
  }
  const parsed = WebLookupResultZ.safeParse(lookup.raw)
  if (!parsed.success || !parsed.data.found || parsed.data.options.length === 0) {
    setWebLookup(rowId, { status: 'failed' })
    return
  }
  setWebLookup(rowId, { status: 'done', result: parsed.data })
  if (parsed.data.options.length === 1) {
    applyWebOption(rowId, parsed.data.options[0]!, parsed.data.source_url)
  }
}
