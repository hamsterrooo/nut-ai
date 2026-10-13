import type { MacroTotals } from '@nutai/core-schema'

/**
 * The health score: 0-10, computed by ARITHMETIC over the meal's totals.
 *
 * D16 applies here with full force — the model never produces this number, and
 * there is no "AI thinks this is healthy" anywhere in the app. Every point comes
 * from a named, threshold-based rule the user can read by tapping the score, and
 * the same meal always scores the same.
 *
 * The rules are density-based (per calorie, not per gram), which is the only
 * basis that doesn't reward eating less of something instead of eating better:
 *
 *   + protein share of energy      (satiety, preservation of lean mass)
 *   + fiber per 100 kcal           (the single best-supported positive marker)
 *   - free-sugar share of energy   (WHO guideline: <10% of energy, ideally <5%)
 *   - sodium per 100 kcal          (2,300 mg over a ~2,000 kcal day ≈ 115/100 kcal)
 *   - energy density, when grams are known (kcal per gram of food as eaten)
 *
 * Saturated fat is deliberately absent: the corpus rows don't reliably carry it,
 * and a rule that fires on a fabricated zero would be worse than no rule.
 */

export interface HealthScore {
  /** 0-10 integer. */
  score: number
  /** One line per rule that actually fired, for the tap-to-see-why sheet. */
  reasons: string[]
}

export function healthScore(t: MacroTotals, totalGrams?: number): HealthScore | null {
  // Below ~30 kcal the shares are numerically meaningless (black coffee, a
  // pickle). No score beats a silly one.
  if (!Number.isFinite(t.kcal) || t.kcal < 30) return null

  let score = 3.5
  const reasons: string[] = []

  const proteinShare = (4 * t.protein_g) / t.kcal
  if (proteinShare >= 0.3) {
    score += 2.5
    reasons.push('Bardzo dużo białka w stosunku do kalorii')
  } else if (proteinShare >= 0.2) {
    score += 2
    reasons.push('Dużo białka w stosunku do kalorii')
  } else if (proteinShare >= 0.12) {
    score += 1
    reasons.push('Rozsądna ilość białka')
  }

  const fiberPer100 = (t.fiber_g * 100) / t.kcal
  if (fiberPer100 >= 2.5) {
    score += 2
    reasons.push('Bardzo dużo błonnika w stosunku do kalorii')
  } else if (fiberPer100 >= 1.4) {
    score += 1.5
    reasons.push('Dużo błonnika w stosunku do kalorii')
  } else if (fiberPer100 >= 0.7) {
    score += 1
    reasons.push('Trochę błonnika')
  }

  const sugarShare = (4 * t.sugar_g) / t.kcal
  if (sugarShare >= 0.3) {
    score -= 2
    reasons.push('Duża część tych kalorii pochodzi z cukru')
  } else if (sugarShare >= 0.15) {
    score -= 1
    reasons.push('Zauważalna część tych kalorii pochodzi z cukru')
  }

  const sodiumPer100 = (t.sodium_mg * 100) / t.kcal
  if (sodiumPer100 >= 400) {
    score -= 2
    reasons.push('Bardzo dużo sodu w stosunku do kalorii')
  } else if (sodiumPer100 >= 230) {
    score -= 1
    reasons.push('Dużo sodu w stosunku do kalorii')
  }

  if (totalGrams != null && totalGrams > 0) {
    const density = t.kcal / totalGrams
    if (density >= 3) {
      score -= 1
      reasons.push('Wysoka gęstość kaloryczna: mała masa niesie dużo energii')
    } else if (density <= 1 && sugarShare < 0.15) {
      // The sugar gate matters: soda is low-density because it is water, and
      // "filling for its calories" is exactly the wrong thing to say about it.
      score += 1
      reasons.push('Niska gęstość kaloryczna: syci w stosunku do kalorii')
    }
  }

  return {
    score: Math.max(0, Math.min(10, Math.round(score))),
    reasons,
  }
}
