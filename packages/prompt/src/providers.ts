/** The providers the app can call, with their price catalogue. Wire formats live in requests.ts. */

export type ProviderId = 'anthropic' | 'openai' | 'google'

export interface ProviderModel {
  id: string
  label: string
  /** USD per million input tokens. */
  inputPerMTok: number
  outputPerMTok: number
  /** Rough cost of one 1024px meal photo scan, in USD. */
  approxScanCostUsd: number
}

/**
 * Model catalogue.
 *
 * The picker is NEUTRAL: price-sorted, no "recommended" badge, no pre-selected
 * provider. Within a chosen provider the cheapest vision-capable model is
 * pre-selected — which is honest rather than a compromise, because the literature
 * says frontier models are NOT better at portion math, which is the dominant error
 * source. Paying 5-30x buys identification quality we mostly already have.
 */
export const PROVIDER_MODELS: Record<ProviderId, ProviderModel[]> = {
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', inputPerMTok: 0.15, outputPerMTok: 0.6, approxScanCostUsd: 0.0009 },
    { id: 'gpt-4o', label: 'GPT-4o', inputPerMTok: 2.5, outputPerMTok: 10, approxScanCostUsd: 0.012 },
  ],
  google: [
    // gemini-2.0-flash-lite was shut down on 2026-06-01 and gemini-2.5-pro is closed to
    // projects that never used it, so a fresh key gets a 404 on both. These are the GA
    // models Google names as the replacements. Google retires model IDs every few
    // months: when a scan starts failing with "model not available", this is the line.
    // approxScanCostUsd assumes ~2k input and ~0.6k output tokens per scan.
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', inputPerMTok: 0.25, outputPerMTok: 1.5, approxScanCostUsd: 0.0014 },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', inputPerMTok: 1.5, outputPerMTok: 9, approxScanCostUsd: 0.0084 },
  ],
  anthropic: [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', inputPerMTok: 1, outputPerMTok: 5, approxScanCostUsd: 0.005 },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', inputPerMTok: 3, outputPerMTok: 15, approxScanCostUsd: 0.018 },
  ],
}

/** Providers sorted cheapest-first. No badges, no editorializing. */
export function providersByPrice(): ProviderId[] {
  return (Object.keys(PROVIDER_MODELS) as ProviderId[]).sort((a, b) => {
    const ca = Math.min(...PROVIDER_MODELS[a].map((m) => m.approxScanCostUsd))
    const cb = Math.min(...PROVIDER_MODELS[b].map((m) => m.approxScanCostUsd))
    return ca - cb
  })
}

export function cheapestModel(provider: ProviderId): ProviderModel {
  const models = PROVIDER_MODELS[provider]
  return models.reduce((a, b) => (a.approxScanCostUsd <= b.approxScanCostUsd ? a : b))
}

/** Cost of one scan from real token counts. Never an estimate once the call returns. */
export function computeScanCost(
  provider: ProviderId,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const model = PROVIDER_MODELS[provider].find((m) => m.id === modelId)
  if (!model) return 0
  return (inputTokens / 1_000_000) * model.inputPerMTok + (outputTokens / 1_000_000) * model.outputPerMTok
}
