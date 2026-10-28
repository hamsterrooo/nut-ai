import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'

/**
 * Chip answers as reversible mutations of the meal.
 *
 * Every answer remembers how to undo itself against the state BEFORE the first
 * answer to that question. Tapping the selected chip again, or tapping a
 * different chip, therefore always works from the original estimate and never
 * compounds (light then heavy is original x2, not original x0.5 x2).
 *
 * Only questions with a real effect are answerable. The rest are hidden by the
 * screen: a chip that does nothing is worse than no chip.
 */

export type AnswerUndo =
  | { kind: 'portion'; fraction: number }
  | { kind: 'rowGrams'; rowId: string; grams: number }
  /** The oil row as it was before any answer (null: there was none). */
  | { kind: 'oil'; original: IngredientRow | null; index: number }

export interface AnswerState {
  value: string
  undo: AnswerUndo
}

export type Answers = Record<string, AnswerState>

/** Sauce amount relative to the model's estimate (its default is "medium"). */
export const SAUCE_FACTOR: Record<string, number> = { light: 0.5, medium: 1, heavy: 2 }

/** Added fat for the oil question. ~1 tbsp of oil is 13 g. */
export const OIL_GRAMS: Record<string, number> = { little: 10, lots: 28 }

const SAUCE_NAME = /(^|[\s(\-/])(sos|dressing|majonez|keczup|ketchup|musztard|winegret|vinaigrette|aioli|tzatziki)/i

export function findSauceRow(meal: LoggedMeal): IngredientRow | undefined {
  return meal.ingredients.find((r) => r.origin !== 'assumption_filler' && SAUCE_NAME.test(r.displayName))
}

export function findOilRow(meal: LoggedMeal): IngredientRow | undefined {
  return meal.ingredients.find((r) => r.origin === 'assumption_filler')
}

const OIL_ANSWER_ID = 'answer-oil'

const ANSWERABLE = new Set(['portion_eaten', 'cooking_oil', 'sauce_type'])

/** Whether answering this question changes anything for this meal. */
export function isAnswerable(questionId: string, meal: LoggedMeal): boolean {
  if (!ANSWERABLE.has(questionId)) return false
  if (questionId === 'sauce_type') return findSauceRow(meal) !== undefined
  return true
}

export function revert(meal: LoggedMeal, undo: AnswerUndo): LoggedMeal {
  switch (undo.kind) {
    case 'portion':
      return { ...meal, portionEatenFraction: undo.fraction }
    case 'rowGrams':
      return {
        ...meal,
        ingredients: meal.ingredients.map((r) => (r.id === undo.rowId ? { ...r, grams: undo.grams } : r)),
      }
    case 'oil': {
      const drop = new Set([OIL_ANSWER_ID, undo.original?.id])
      const next = meal.ingredients.filter((r) => !drop.has(r.id))
      if (undo.original) next.splice(Math.min(undo.index, next.length), 0, undo.original)
      return { ...meal, ingredients: next }
    }
  }
}

function oilRow(grams: number): IngredientRow {
  return {
    id: OIL_ANSWER_ID,
    displayName: 'Olej lub masło do smażenia',
    sourceFoodId: null,
    grams,
    // Per 100 g of vegetable oil.
    nutrientSnapshot: { kcal: 884, protein_g: 0, fat_g: 100, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
    origin: 'assumption_filler',
    gramPathway: 'user_edited',
    bandHalfPct: 0.5,
    isEstimate: true,
    assumptions: [{ type: 'oil_added', gramsEquiv: grams, userConfirmed: true }],
  }
}

/**
 * Apply `value` for `questionId`. `previous` is the existing answer to the same
 * question, if any: the meal is first reverted to the original, then the new
 * value is applied, and the ORIGINAL undo is kept.
 */
export function applyAnswer(
  meal: LoggedMeal,
  questionId: string,
  value: string,
  previous?: AnswerState,
): { meal: LoggedMeal; state: AnswerState } | null {
  if (!isAnswerable(questionId, meal) && !previous) return null
  const base = previous ? revert(meal, previous.undo) : meal

  if (questionId === 'portion_eaten') {
    const f = Number(value)
    if (!Number.isFinite(f)) return null
    const undo: AnswerUndo = previous?.undo ?? { kind: 'portion', fraction: base.portionEatenFraction }
    return {
      meal: { ...base, portionEatenFraction: Math.max(0, Math.min(1, f)) },
      state: { value, undo },
    }
  }

  if (questionId === 'sauce_type') {
    const factor = SAUCE_FACTOR[value]
    const sauce = findSauceRow(base)
    if (factor === undefined || !sauce) return null
    const undo: AnswerUndo = previous?.undo ?? { kind: 'rowGrams', rowId: sauce.id, grams: sauce.grams }
    const grams = undo.kind === 'rowGrams' ? undo.grams * factor : sauce.grams
    return {
      meal: {
        ...base,
        ingredients: base.ingredients.map((r) => (r.id === sauce.id ? { ...r, grams } : r)),
      },
      state: { value, undo },
    }
  }

  if (questionId === 'cooking_oil') {
    const existing = findOilRow(base)
    const undo: AnswerUndo = previous?.undo ?? {
      kind: 'oil',
      original: existing ?? null,
      index: existing ? base.ingredients.findIndex((r) => r.id === existing.id) : base.ingredients.length,
    }

    if (value === 'none') {
      return {
        meal: existing ? { ...base, ingredients: base.ingredients.filter((r) => r.id !== existing.id) } : base,
        state: { value, undo },
      }
    }

    const grams = OIL_GRAMS[value]
    if (grams === undefined) return null
    return {
      meal: existing
        ? {
            ...base,
            ingredients: base.ingredients.map((r) => (r.id === existing.id ? { ...r, grams } : r)),
          }
        : { ...base, ingredients: [...base.ingredients, oilRow(grams)] },
      state: { value, undo },
    }
  }

  return null
}

/** Rows an answer's undo points at, so a manual edit of that row can drop the answer. */
export function undoRowId(undo: AnswerUndo): string | null {
  if (undo.kind === 'rowGrams') return undo.rowId
  if (undo.kind === 'oil') return undo.original?.id ?? OIL_ANSWER_ID
  return null
}
