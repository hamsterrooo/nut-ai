import type { Band } from '@nutai/confidence'
import type { IngredientRow, LoggedMeal, WebLookupOption, WebLookupResult } from '@nutai/core-schema'
import type { ProviderId } from '@nutai/prompt'
import type { ScanResult } from '@nutai/pipeline'
import { recomputeAfterEdit } from '@nutai/pipeline'
import type { SelectedQuestion } from '@nutai/repair'
import { useSyncExternalStore } from 'react'
import { applyAnswer, revert, undoRowId, type Answers } from './answers'
import type { ScanFailureKind } from '../inference/pathA/client'

/**
 * The in-flight scan.
 *
 * Deliberately a tiny external store rather than a state library: this holds one
 * meal at a time and every mutation is the same operation — edit the rows, then
 * recompute. Adding a dependency for that would be more machinery than the
 * problem has.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT: every mutation below runs
 * `recomputeAfterEdit` locally and synchronously. No network call, no database
 * read, no model call. That is what makes correction free, instant, offline, and
 * identical on both inference paths — and it is only possible because every row
 * already carries its own per-100 g snapshot.
 */

/** What the scan cost and where it ran — carried to the ledger at log time. */
export interface ScanMeta {
  /** What the user selected. */
  provider: ProviderId
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  promptVersion: string
}

/** Per-row web-search refinement state, keyed by ingredient row id. */
export type WebLookupState =
  | { status: 'running' }
  | { status: 'done'; result: WebLookupResult }
  | { status: 'failed' }

export type ScanPhase =
  | { kind: 'idle' }
  | { kind: 'captured'; photoUri: string }
  | {
      kind: 'analyzing'
      photoUri: string
      /** Which stage, for honest progress copy — never a fake percentage. */
      stage: 'preparing' | 'identifying' | 'matching'
    }
  | {
      kind: 'ready'
      photoUri: string | null
      result: ScanResult
      bands: Band[]
      meta: ScanMeta | null
      webLookups: Record<string, WebLookupState>
      /** Selected chip per question id, with the undo that restores the original estimate. */
      answers?: Answers
      /** The user's own name and description for the meal. */
      title?: string
      note?: string
    }
  | {
      kind: 'failed'
      photoUri: string
      message: string
      canRetry: boolean
      failureKind?: ScanFailureKind | 'no-key'
      /** Screen title; defaults to the meal-photo wording when absent. */
      headline?: string
      /** Show the "photograph the label" action (barcode misses). */
      offerLabel?: boolean
      /** Short copyable reason shown under the message: HTTP status, failure kind or SCHEMA. */
      code?: string
    }

let phase: ScanPhase = { kind: 'idle' }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useScan(): ScanPhase {
  return useSyncExternalStore(subscribe, () => phase, () => phase)
}

export function setPhase(next: ScanPhase) {
  // A scan that finishes while a basket is waiting joins it: one meal, many scans.
  if (next.kind === 'ready' && basket) {
    next = mergeBasket(basket, next)
    basket = null
  }
  phase = next
  emit()
}

// ---------------------------------------------------------------------------
// Basket: several scans, one meal.
// ---------------------------------------------------------------------------

type ReadyPhase = Extract<ScanPhase, { kind: 'ready' }>

let basket: ReadyPhase | null = null
let basketSeq = 0

export function basketSize(): number {
  return basket?.result.meal.ingredients.length ?? 0
}

/** Park the current result and free the camera for the next product. */
export function stashToBasket() {
  if (phase.kind !== 'ready') return
  basket = phase
  phase = { kind: 'idle' }
  emit()
}

/** Bring the parked products back as the current meal (camera closed without a new scan). */
export function restoreBasket() {
  if (!basket) return
  phase = basket
  basket = null
  emit()
}

export function clearBasket() {
  basket = null
}

function mergeBasket(parked: ReadyPhase, next: ReadyPhase): ReadyPhase {
  const tag = `b${++basketSeq}-`
  const rows = parked.result.meal.ingredients.map((r) => ({ ...r, id: tag + r.id }))
  const items = rows.map((row, i) => {
    const original = parked.result.items[i]
    return original
      ? { ...original, row }
      : { row, band: parked.bands[i]!, resolution: 'miss' as const, gramPathway: row.gramPathway }
  })
  const bands = [...rows.map((r, i) => parked.bands[i] ?? { halfPct: r.bandHalfPct, tier: 'moderate' as const, reasons: [] }), ...next.bands]
  const meal: LoggedMeal = {
    ...next.result.meal,
    ingredients: [...rows, ...next.result.meal.ingredients],
    portionEatenFraction: parked.result.meal.portionEatenFraction,
  }
  const { totals, mealBand } = recomputeAfterEdit(meal, bands)
  return {
    ...next,
    bands,
    webLookups: { ...next.webLookups },
    result: { ...next.result, meal, items: [...items, ...next.result.items], totals, mealBand },
    ...(parked.title ? { title: parked.title } : {}),
    ...(parked.note ? { note: parked.note } : {}),
  }
}

export function setTitle(title: string) {
  if (phase.kind !== 'ready') return
  phase = { ...phase, title }
  emit()
}

export function setNote(note: string) {
  if (phase.kind !== 'ready') return
  phase = { ...phase, note }
  emit()
}

/**
 * Swap a row's food for a specific database product, keeping the grams. The row
 * becomes an exact one (the user picked it), so it is shown without the AI badge.
 */
export function replaceRowFood(
  rowId: string,
  food: { foodId: number; displayName: string; nutrientSnapshot: IngredientRow['nutrientSnapshot'] },
) {
  mutateMeal((meal) => ({
    ...meal,
    ingredients: meal.ingredients.map((r) =>
      r.id === rowId
        ? {
            ...r,
            displayName: food.displayName,
            sourceFoodId: String(food.foodId),
            nutrientSnapshot: food.nutrientSnapshot,
            origin: 'manual_custom' as const,
            gramPathway: 'user_edited' as const,
            isEstimate: false,
            bandHalfPct: 0.1,
          }
        : r,
    ),
  }))
}

/** Non-hook read for the orchestrator (Fix Result needs the current rows). */
export function getPhase(): ScanPhase {
  return phase
}

/** Every edit path funnels through here, so the invariant holds in exactly one place. */
function mutateMeal(fn: (meal: LoggedMeal) => LoggedMeal, answers?: Answers) {
  if (phase.kind !== 'ready') return
  const meal = fn(phase.result.meal)
  const { totals, mealBand } = recomputeAfterEdit(meal, phase.bands)
  phase = {
    ...phase,
    result: { ...phase.result, meal, totals, mealBand },
    ...(answers ? { answers } : {}),
  }
  emit()
}

/**
 * A manual edit of a row wins over any chip answer that scaled it: the chip
 * deselects and the typed value stands, instead of a later revert overwriting it.
 */
function answersWithout(rowId: string): Answers | undefined {
  if (phase.kind !== 'ready' || !phase.answers) return undefined
  const kept: Answers = {}
  let changed = false
  for (const [id, a] of Object.entries(phase.answers)) {
    if (undoRowId(a.undo) === rowId) changed = true
    else kept[id] = a
  }
  return changed ? kept : undefined
}

export function editGrams(rowId: string, grams: number) {
  if (!Number.isFinite(grams) || grams < 0) return
  const answers = answersWithout(rowId)
  mutateMeal(
    (meal) => ({
      ...meal,
      ingredients: meal.ingredients.map((r) => (r.id === rowId ? { ...r, grams } : r)),
    }),
    answers,
  )
}

export function removeRow(rowId: string) {
  // No special-casing "AI-added" versus "user-added" once a row is in the list.
  // There is no data-model difference between "the AI added rice and I removed
  // it" and "I removed rice because I didn't eat it".
  const answers = answersWithout(rowId)
  mutateMeal(
    (meal) => ({
      ...meal,
      ingredients: meal.ingredients.filter((r) => r.id !== rowId),
    }),
    answers,
  )
}

export function addRow(row: IngredientRow) {
  mutateMeal((meal) => ({ ...meal, ingredients: [...meal.ingredients, row] }))
}

export function setPortionEaten(fraction: number) {
  mutateMeal((meal) => ({ ...meal, portionEatenFraction: Math.max(0, Math.min(1, fraction)) }))
}

/**
 * Answering a clarifying chip IS an add/remove/edit operation.
 *
 * "Yes there was oil" pushes an assumption-filler row; "no oil" removes it; "oat
 * milk instead of whole" swaps a row's snapshot. There is no separate code path
 * for questions — the chip UI is a friendly wrapper over the same three
 * primitives, which is what makes the two impossible to get out of sync.
 */
export function answerQuestion(q: SelectedQuestion, value: string) {
  if (phase.kind !== 'ready') return
  const id = q.question.id
  const answers = phase.answers ?? {}
  const current = answers[id]

  // Tapping the selected chip again undoes the answer: back to the original estimate.
  if (current && current.value === value) {
    const { [id]: _removed, ...rest } = answers
    mutateMeal((meal) => revert(meal, current.undo), rest)
    return
  }

  const applied = applyAnswer(phase.result.meal, id, value, current)
  if (!applied) return
  mutateMeal(() => applied.meal, { ...answers, [id]: applied.state })
}

/** The currently selected value for a question, or null. */
export function selectedAnswer(p: ScanPhase, questionId: string): string | null {
  return p.kind === 'ready' ? (p.answers?.[questionId]?.value ?? null) : null
}

export function setWebLookup(rowId: string, state: WebLookupState) {
  if (phase.kind !== 'ready') return
  phase = { ...phase, webLookups: { ...phase.webLookups, [rowId]: state } }
  emit()
}

/**
 * Apply a web-lookup option: swap the row's snapshot for the transcribed
 * published values. A LOCAL operation — the search already paid for every
 * option's data, so choosing between them costs nothing.
 */
export function applyWebOption(rowId: string, option: WebLookupOption, sourceUrl: string | null) {
  mutateMeal((meal) => ({
    ...meal,
    ingredients: meal.ingredients.map((r) => {
      if (r.id !== rowId) return r
      const grams = option.serving_g ?? r.grams
      // Published values are PER SERVING; the snapshot is per 100 g.
      const per100 = grams > 0 ? 100 / grams : 0
      return {
        ...r,
        displayName: option.label,
        grams,
        nutrientSnapshot: {
          kcal: option.calories_kcal * per100,
          protein_g: option.protein_g * per100,
          fat_g: option.fat_g * per100,
          carbs_g: option.carbs_g * per100,
          fiber_g: option.fiber_g == null ? null : option.fiber_g * per100,
          sugar_g: null,
          sodium_mg: option.sodium_mg == null ? null : option.sodium_mg * per100,
        },
        origin: 'web_lookup' as const,
        sourceUrl,
        // Label-quality numbers: rounding rules plus serving variation, far
        // tighter than a visual estimate but never zero.
        bandHalfPct: 0.1,
        isEstimate: false,
      }
    }),
  }))
}

export function reset() {
  setPhase({ kind: 'idle' })
}
