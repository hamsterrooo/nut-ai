/**
 * EU label arithmetic.
 *
 * EU nutrition panels print SALT (g), not sodium, and print energy as kJ next to
 * kcal. Both conversions are fixed definitions, not estimates, so they live in
 * code where they are tested rather than in a prompt where a model would do the
 * arithmetic.
 *
 *   salt (g) = sodium (g) x 2.5   ->   1 g of salt = 400 mg of sodium
 *   1 kcal   = 4.184 kJ
 */

export const SODIUM_MG_PER_SALT_G = 400
export const KJ_PER_KCAL = 4.184

/** Sodium in mg for a printed salt figure in grams. */
export function sodiumMgFromSaltG(saltG: number): number {
  return saltG * SODIUM_MG_PER_SALT_G
}

/** kcal for a printed kJ figure, rounded to a whole kcal like a printed value. */
export function kcalFromKj(kj: number): number {
  return Math.round(kj / KJ_PER_KCAL)
}
