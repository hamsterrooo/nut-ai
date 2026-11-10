import { useSyncExternalStore } from 'react'
import type { ActivityLevel, Sex } from '@nutai/goals'
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
 *   desiredWeightKg                      -> deficit direction and rate (the goal is inferred from it)
 *   dietStyle                            -> shown in the plan recap and on Profile
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

export const DIET_LABEL_PL: Record<DietStyle, string> = {
  balanced: 'Zbilansowana',
  whole_food: 'Nieprzetworzona żywność',
  mediterranean: 'Śródziemnomorska',
  flexitarian: 'Fleksitariańska',
  pescatarian: 'Peskatariańska',
  vegetarian: 'Wegetariańska',
  vegan: 'Wegańska',
}

/** Polish display names for values that are otherwise internal keys. */
export const ACTIVITY_LABEL_PL: Record<string, string> = {
  sedentary: 'siedzący tryb życia',
  light: 'niska aktywność',
  moderate: 'umiarkowana aktywność',
  active: 'wysoka aktywność',
  very_active: 'bardzo wysoka aktywność',
}
