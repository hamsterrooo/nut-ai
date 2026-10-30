import { useSyncExternalStore } from 'react'
import type { ActivityLevel, Goal, Sex } from '@nutai/goals'
import type { ProviderId } from '@nutai/prompt'

/**
 * Onboarding answers.
 *
 * EVERY FIELD HERE HAS A CONSUMER. That is the rule this file is written against.
 *
 * The app we are cloning asks several questions purely to manufacture
 * psychological investment before a paywall — the research corpus is explicit
 * that "what's stopping you" and "what would you like to accomplish" exist to
 * raise conversion, not to change the product. We have no paywall, so an
 * unanswered-for-no-reason question would be pure interrogation.
 *
 * So each of those screens is kept for UX parity AND given a real job:
 *
 *   sex, birthYear, heightCm, weightKg   -> Mifflin-St Jeor, directly
 *   workoutsPerWeek                      -> the activity multiplier
 *   goal, desiredWeightKg                -> deficit direction and rate
 *   dietStyle                            -> RESOLVER BIAS. A vegan's scan should
 *                                           not resolve to a beef row, and the
 *                                           oil/milk assumption-filler defaults
 *                                           change with the diet.
 *
 * If a field is ever added here without a consumer, delete the screen instead.
 */

export type WorkoutFrequency = '0-2' | '3-5' | '6+'
export type UnitSystem = 'metric'

export type DietStyle =
  | 'balanced'
  | 'whole_food'
  | 'mediterranean'
  | 'flexitarian'
  | 'pescatarian'
  | 'vegetarian'
  | 'vegan'

export interface OnboardingAnswers {
  sex: Sex | null
  workoutsPerWeek: WorkoutFrequency | null
  birthYear: number | null
  birthMonth: number | null
  birthDay: number | null
  heightCm: number | null
  weightKg: number | null
  units: UnitSystem
  goal: Goal | null
  desiredWeightKg: number | null
  dietStyle: DietStyle | null
  /**
   * A vendor is the user's own key; 'none' means no cloud path — barcode,
   * search and manual still work.
   */
  provider: ProviderId | 'none' | undefined
  providerModel: string | null
}

const EMPTY: OnboardingAnswers = {
  sex: null,
  workoutsPerWeek: null,
  birthYear: null,
  birthMonth: null,
  birthDay: null,
  heightCm: null,
  weightKg: null,
  units: 'metric',
  goal: null,
  desiredWeightKg: null,
  dietStyle: null,
  provider: undefined,
  providerModel: null,
}

let answers: OnboardingAnswers = { ...EMPTY }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function useAnswers(): OnboardingAnswers {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => answers,
    () => answers,
  )
}

export function setAnswer<K extends keyof OnboardingAnswers>(
  key: K,
  value: OnboardingAnswers[K],
): void {
  answers = { ...answers, [key]: value }
  emit()
}

export function getAnswers(): OnboardingAnswers {
  return answers
}

export function resetAnswers(): void {
  answers = { ...EMPTY }
  emit()
}

/** Workout frequency to the activity multiplier the goals math expects. */
export function activityFor(w: WorkoutFrequency | null): ActivityLevel {
  switch (w) {
    case '0-2':
      return 'light'
    case '3-5':
      return 'moderate'
    case '6+':
      return 'active'
    default:
      return 'sedentary'
  }
}

/** Age from the birth date, using a caller-supplied "today" so this stays pure. */
export function ageFrom(a: OnboardingAnswers, todayMs: number): number {
  if (a.birthYear == null) return 30
  const now = new Date(todayMs)
  let age = now.getUTCFullYear() - a.birthYear
  const monthNow = now.getUTCMonth() + 1
  const m = a.birthMonth ?? 1
  const d = a.birthDay ?? 1
  if (monthNow < m || (monthNow === m && now.getUTCDate() < d)) age--
  return Math.max(13, Math.min(100, age))
}

// ---------------------------------------------------------------------------
// The consumers. These are what make the extra screens earn their place.
// ---------------------------------------------------------------------------

/**
 * Diet style biases FOOD RESOLUTION, which is the most useful thing any of these
 * answers can do. A vegan photographing a burrito should not silently resolve to
 * a beef row, and the "what kind of milk?" assumption default should be oat
 * rather than whole.
 */
export interface DietBias {
  /** Regex of food terms to demote in resolver scoring. */
  demote: RegExp | null
  /** Default answer for the milk clarifying question. */
  defaultMilk: string
  /** Default cooking fat assumed when oil is invisible. */
  defaultFat: string
  label: string
}

export const DIET_BIAS: Record<DietStyle, DietBias> = {
  balanced: { demote: null, defaultMilk: 'whole', defaultFat: 'vegetable oil', label: 'Zbilansowana' },
  whole_food: {
    demote: /\b(candy|soda|chips|processed|instant)\b/i,
    defaultMilk: 'whole',
    defaultFat: 'olive oil',
    label: 'Nieprzetworzona żywność',
  },
  mediterranean: {
    demote: /\b(bacon|sausage|processed)\b/i,
    defaultMilk: 'whole',
    defaultFat: 'olive oil',
    label: 'Śródziemnomorska',
  },
  flexitarian: {
    demote: /\b(beef|pork|lamb)\b/i,
    defaultMilk: 'whole',
    defaultFat: 'olive oil',
    label: 'Fleksitariańska',
  },
  pescatarian: {
    demote: /\b(beef|pork|chicken|turkey|lamb|bacon)\b/i,
    defaultMilk: 'whole',
    defaultFat: 'olive oil',
    label: 'Peskatariańska',
  },
  vegetarian: {
    demote: /\b(beef|pork|chicken|turkey|lamb|fish|salmon|tuna|bacon|shrimp)\b/i,
    defaultMilk: 'whole',
    defaultFat: 'vegetable oil',
    label: 'Wegetariańska',
  },
  vegan: {
    demote: /\b(beef|pork|chicken|turkey|lamb|fish|salmon|tuna|bacon|shrimp|cheese|milk|butter|egg|yogurt|cream)\b/i,
    defaultMilk: 'oat',
    defaultFat: 'vegetable oil',
    label: 'Wegańska',
  },
}

/** Polish display names for values that are otherwise internal keys. */
export const ACTIVITY_LABEL_PL: Record<string, string> = {
  sedentary: 'siedzący tryb życia',
  light: 'niska aktywność',
  moderate: 'umiarkowana aktywność',
  active: 'wysoka aktywność',
  very_active: 'bardzo wysoka aktywność',
}

/**
 * Pounds per kilogram. The app itself is metric-only; this exists solely to feed
 * @nutai/goals, whose calorie arithmetic is written in pounds per week.
 */
export const LB_PER_KG = 2.20462

/**
 * Weight change below this is treated as "maintain".
 *
 * 1 kg is inside the range a single day of water, salt and timing can move you,
 * so a target within 1 kg of today is not a direction — it is the same weight
 * measured twice. Asking someone to also declare a goal after they have already
 * told us both numbers is asking them to repeat themselves.
 */
export const MAINTAIN_THRESHOLD_KG = 1

/**
 * The goal, inferred.
 *
 * Current weight and target weight already contain the answer. A separate
 * "what is your goal?" screen can only agree with them or contradict them, and
 * when it contradicts them the app has to silently pick a winner.
 */
export function inferredGoal(a: Pick<OnboardingAnswers, 'weightKg' | 'desiredWeightKg'>): Goal {
  const current = a.weightKg
  const target = a.desiredWeightKg
  if (current == null || target == null) return 'maintain'
  const deltaKg = target - current
  if (Math.abs(deltaKg) < MAINTAIN_THRESHOLD_KG) return 'maintain'
  return deltaKg > 0 ? 'gain' : 'lose'
}

/** Adapter for @nutai/goals only; never shown to the user. */
export const kgToLb = (kg: number): number => kg * LB_PER_KG
