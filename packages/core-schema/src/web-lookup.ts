import { z } from 'zod'
import { sodiumMgFromSaltG } from './eu-units.js'

/**
 * The web-lookup refinement result.
 *
 * When the local corpus misses a branded or restaurant item, a second provider
 * call runs with the provider's server-side web-search tool and returns this
 * shape. Two rules keep it honest:
 *
 *   EVERY OPTION CARRIES ITS OWN PUBLISHED NUTRITION. The clarifying question
 *   ("Which Chick-fil-A sandwich?") is answerable locally, instantly, for free —
 *   tapping an option swaps a snapshot, it does not trigger another model call.
 *
 *   NUMBERS ARE TRANSCRIBED, NEVER INVENTED. The prompt requires values read off
 *   the brand's published nutrition facts, with the source URL attached, and the
 *   UI shows the domain. A transcription with a citation is a different class of
 *   claim from a model guess, and the provenance field keeps them distinct.
 */

export const WebLookupOptionZ = z
  .object({
    /** Menu-item label as published, e.g. "Spicy Deluxe Sandwich". */
    label: z.string().min(1),
    /** Grams for one serving as published; null when the source lists no weight. */
    serving_g: z.number().positive().nullable(),
    /** Human description of the serving, e.g. "1 sandwich (232 g)". */
    serving_desc: z.string().nullable(),
    calories_kcal: z.number().min(0),
    protein_g: z.number().min(0),
    carbs_g: z.number().min(0),
    fat_g: z.number().min(0),
    fiber_g: z.number().min(0).nullable(),
    sodium_mg: z.number().min(0).nullable(),
    /**
     * Salt in grams, for sources (EU labels, Polish retailers) that publish salt
     * instead of sodium. Converted to sodium_mg below; never shown on its own.
     */
    salt_g: z.number().min(0).nullish(),
  })
  .transform(({ salt_g, ...o }) => ({
    ...o,
    sodium_mg: o.sodium_mg ?? (salt_g != null ? sodiumMgFromSaltG(salt_g) : null),
  }))

export const WebLookupResultZ = z.object({
  /** False when search found nothing usable — the item stays an AI estimate. */
  found: z.boolean(),
  /** Where the numbers came from. Required whenever found is true. */
  source_url: z.string().nullable(),
  /**
   * One entry when the item was unambiguous; several when the menu has variants
   * the photo cannot distinguish. The UI renders >1 as a multiple-choice card
   * with a free-text Other underneath.
   */
  options: z.array(WebLookupOptionZ).max(6),
  /** The question to show above the options when there are several. */
  question: z.string().nullable(),
})

export type WebLookupOption = z.infer<typeof WebLookupOptionZ>
export type WebLookupResult = z.infer<typeof WebLookupResultZ>
