import { z } from 'zod'
import { kcalFromKj, sodiumMgFromSaltG } from './eu-units.js'

/**
 * A transcribed nutrition-facts label.
 *
 * The label scanner is TRANSCRIPTION, not estimation: the model reads a printed
 * panel and copies its numbers. That makes the resulting row the most trusted
 * kind in the app (gramPathway 'packaged_exact', the top of the ladder) — but
 * only if serving_g was actually printed. A label whose serving size cannot be
 * read produces a failure the user can see, never a guessed weight.
 */

/**
 * One column of a printed panel: the per-serving column, or — on labels that only
 * print "w 100 g" — the per-100 g column standing in for it (the prompt sets
 * serving_g to 100 in that case).
 *
 * EU panels print energy in kJ and kcal and print SALT, not sodium. The model
 * transcribes whatever is printed; this transform is where the fixed conversions
 * happen, so a model is never asked to do arithmetic on a number it just read:
 *   - kcal missing (0) but kJ printed  -> kcal = kJ / 4.184
 *   - sodium missing but salt printed  -> sodium_mg = salt_g x 400
 * A figure the label actually printed always wins over a derived one.
 */
export const LabelPerServingZ = z
  .object({
    calories_kcal: z.number().min(0),
    energy_kj: z.number().min(0).nullish(),
    protein_g: z.number().min(0),
    carbs_g: z.number().min(0),
    fat_g: z.number().min(0),
    fiber_g: z.number().min(0).nullable(),
    sugar_g: z.number().min(0).nullable(),
    sodium_mg: z.number().min(0).nullable(),
    salt_g: z.number().min(0).nullish(),
  })
  .transform((p) => ({
    calories_kcal: p.calories_kcal > 0 || !p.energy_kj ? p.calories_kcal : kcalFromKj(p.energy_kj),
    protein_g: p.protein_g,
    carbs_g: p.carbs_g,
    fat_g: p.fat_g,
    fiber_g: p.fiber_g,
    sugar_g: p.sugar_g,
    sodium_mg: p.sodium_mg ?? (p.salt_g != null ? sodiumMgFromSaltG(p.salt_g) : null),
  }))

export const LabelPayloadZ = z.object({
  /** Product name if printed near the panel; null when only the panel is shown. */
  product_name: z.string().nullable(),
  /** e.g. "1 porcja (30 g)" or "100 g" when only the per-100 g column is printed. */
  serving_desc: z.string().nullable(),
  /** Grams per serving. Null when the label truly does not state one. */
  serving_g: z.number().positive().nullable(),
  servings_per_container: z.number().positive().nullable(),
  per_serving: LabelPerServingZ,
})

export type LabelPayload = z.infer<typeof LabelPayloadZ>
