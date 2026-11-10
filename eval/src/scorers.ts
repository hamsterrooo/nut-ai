/**
 * Accuracy scorers.
 *
 * SPEC-accuracy-engine.md §8.4 / PLAN.md §8.4.
 *
 * Every metric here exists because a simpler one would hide something:
 *
 *   MEDIAN and IQR alongside the mean, because the distributions are heavy-tailed
 *   (Lo 2024: MAE 69.2±34.7 kcal for a single food, 151.2±125.3 for a mixed meal).
 *   A mean alone cannot distinguish "uniformly mediocre" from "mostly fine with a
 *   few catastrophic misses", and those call for completely different work.
 *
 *   MSPE, signed, because the most corroborated finding in the whole corpus is
 *   systematic UNDERCOUNTING — and MAPE, being absolute, is blind to it. An app
 *   that is 30% wrong in both directions is a different product from one that is
 *   30% low every time.
 *
 *   BAND COVERAGE, because it is the only metric that tests the honesty claim
 *   rather than the accuracy claim. A systematically too-narrow band is a
 *   ship-blocker even when MAPE looks respectable: it means the app says "I am
 *   confident" and is wrong.
 */

export interface Prediction {
  dishId: string
  stratum: string
  pathway: string
  predictedKcal: number
  predictedGrams: number
  /** Half-width of the displayed band, as a fraction. */
  bandHalfPct: number
}

export interface GroundTruth {
  dishId: string
  stratum: string
  /** Kitchen-scale weighed. Never an estimate — that would be circular. */
  actualKcal: number
  actualGrams: number
}

export interface Metrics {
  n: number
  /** Mean absolute percentage error. */
  mape: number
  /** Median APE. Reported alongside the mean because the tails are heavy. */
  medianApe: number
  iqr: [number, number]
  /** Mean SIGNED percentage error. Negative means systematic undercounting. */
  mspe: number
  mae: number
  /** Fraction of dishes whose truth fell inside the displayed range. */
  bandCoverage: number
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  const a = sorted[lo] ?? 0
  const b = sorted[hi] ?? a
  return a + (b - a) * (i - lo)
}

export function computeMetrics(
  predictions: readonly Prediction[],
  truth: readonly GroundTruth[],
): Metrics {
  const byId = new Map(truth.map((t) => [t.dishId, t]))
  const apes: number[] = []
  const spes: number[] = []
  const aes: number[] = []
  let covered = 0
  let n = 0

  for (const p of predictions) {
    const t = byId.get(p.dishId)
    if (!t || t.actualKcal <= 0) continue
    n++

    const signed = (p.predictedKcal - t.actualKcal) / t.actualKcal
    spes.push(signed)
    apes.push(Math.abs(signed))
    aes.push(Math.abs(p.predictedKcal - t.actualKcal))

    const low = p.predictedKcal * (1 - p.bandHalfPct)
    const high = p.predictedKcal * (1 + p.bandHalfPct)
    if (t.actualKcal >= low && t.actualKcal <= high) covered++
  }

  if (n === 0) {
    return { n: 0, mape: 0, medianApe: 0, iqr: [0, 0], mspe: 0, mae: 0, bandCoverage: 0 }
  }

  const sortedApes = [...apes].sort((a, b) => a - b)
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

  return {
    n,
    mape: mean(apes),
    medianApe: percentile(sortedApes, 0.5),
    iqr: [percentile(sortedApes, 0.25), percentile(sortedApes, 0.75)],
    mspe: mean(spes),
    mae: mean(aes),
    bandCoverage: covered / n,
  }
}

/** Per-stratum, never pooled. Pooling hides exactly the variation we care about. */
export function metricsByStratum(
  predictions: readonly Prediction[],
  truth: readonly GroundTruth[],
): Record<string, Metrics> {
  const strata = [...new Set(truth.map((t) => t.stratum))]
  const out: Record<string, Metrics> = {}
  for (const s of strata) {
    const ids = new Set(truth.filter((t) => t.stratum === s).map((t) => t.dishId))
    out[s] = computeMetrics(predictions.filter((p) => ids.has(p.dishId)), truth)
  }
  return out
}

// ---------------------------------------------------------------------------
// The merge gate
// ---------------------------------------------------------------------------

export interface Baselines {
  /** Per-stratum calorie MAPE at the last accepted run. */
  mapeByStratum: Record<string, number>
  bandCoverageByStratum: Record<string, number>
  /** 'seeded' until a real golden-set run replaces it. Shown in-app. */
  provenance: 'seeded' | 'measured'
  generatedAt: string | null
}

export interface GateResult {
  pass: boolean
  failures: string[]
  warnings: string[]
}

export const GATE = {
  /** Block on a >10% relative regression in any stratum's calorie MAPE. */
  maxMapeRegression: 0.1,
  /**
   * Block below 70% band coverage in any stratum.
   *
   * This is the single most important number in the project. A too-narrow band
   * means the app claims confidence it has not earned, and that is a worse
   * failure than being inaccurate while saying so.
   */
  minBandCoverage: 0.7,
  /** The target the honesty claim is actually built on. */
  targetBandCoverage: 0.75,
} as const

export function evaluateGate(
  current: Record<string, Metrics>,
  baselines: Baselines,
): GateResult {
  const failures: string[] = []
  const warnings: string[] = []

  for (const [stratum, m] of Object.entries(current)) {
    if (m.n === 0) continue

    const base = baselines.mapeByStratum[stratum]
    if (base != null && base > 0) {
      const regression = (m.mape - base) / base
      if (regression > GATE.maxMapeRegression) {
        failures.push(
          `${stratum}: calorie MAPE regressed ${(regression * 100).toFixed(1)}% (${(base * 100).toFixed(1)}% -> ${(m.mape * 100).toFixed(1)}%)`,
        )
      }
    }

    if (m.bandCoverage < GATE.minBandCoverage) {
      failures.push(
        `${stratum}: band coverage ${(m.bandCoverage * 100).toFixed(1)}% is below the ${GATE.minBandCoverage * 100}% floor — the displayed range is too narrow to be honest`,
      )
    } else if (m.bandCoverage < GATE.targetBandCoverage) {
      warnings.push(
        `${stratum}: band coverage ${(m.bandCoverage * 100).toFixed(1)}% is under the ${GATE.targetBandCoverage * 100}% target`,
      )
    }

    // Not a blocker, but a directed instruction rather than a dashboard number:
    // a strongly negative MSPE means invest in the oil flow specifically.
    if (m.mspe < -0.15) {
      warnings.push(
        `${stratum}: MSPE ${(m.mspe * 100).toFixed(1)}% — systematic UNDERCOUNTING. Per the pre-registered rule, invest in the oil question flow and the mechanical oil-absorption correction, not generic accuracy work.`,
      )
    }
  }

  return { pass: failures.length === 0, failures, warnings }
}

/**
 * Pre-registered decision rule 2: fit signed_error ~ actual_calories.
 *
 * A meaningfully negative slope (Fridolfsson 2025 reports -0.23 to -0.50) argues
 * for portion-size-DEPENDENT band widening rather than the flat category widening
 * currently specified. Pre-registering the rule is what stops it becoming a
 * post-hoc story about whatever the data happened to show.
 */
export function errorVsPortionSlope(
  predictions: readonly Prediction[],
  truth: readonly GroundTruth[],
): number | null {
  const byId = new Map(truth.map((t) => [t.dishId, t]))
  const pts: Array<[number, number]> = []
  for (const p of predictions) {
    const t = byId.get(p.dishId)
    if (!t || t.actualKcal <= 0) continue
    pts.push([t.actualKcal, (p.predictedKcal - t.actualKcal) / t.actualKcal])
  }
  if (pts.length < 3) return null

  const n = pts.length
  const meanX = pts.reduce((s, [x]) => s + x, 0) / n
  const meanY = pts.reduce((s, [, y]) => s + y, 0) / n
  let num = 0
  let den = 0
  for (const [x, y] of pts) {
    num += (x - meanX) * (y - meanY)
    den += (x - meanX) ** 2
  }
  return den === 0 ? null : num / den
}
