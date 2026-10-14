import {
  buildAnthropicRequest,
  buildGeminiRequest,
  buildLabelScanRequest,
  buildOpenAIRequest,
  buildReceiptScanRequest,
  buildTextJsonRequest,
  buildWebLookupRequest,
  computeScanCost,
  type ProviderId,
} from '@nutai/prompt'
import {
  chargeUsdFromHeaders,
  classifyGatewayError,
  isPublikResponse,
  walletPatchFromHeaders,
  type PublikWalletPatch,
} from '../publik-core'

/**
 * Path A — the cloud inference client.
 *
 * SPEC-accuracy-engine.md §3, PLAN.md D10. A thin wrapper over React Native's
 * `fetch`, deliberately NOT the vendor Node SDKs: those assume Node runtime
 * features Hermes does not guarantee. Non-streaming, one request in, one JSON
 * object out — which removes the single largest RN fetch/ReadableStream risk from
 * the core feature.
 *
 * This is the ONLY place in the app that reads an API key, and the key travels to
 * exactly one destination: the provider the user named — or, on publik mode,
 * publik API's gateway (`baseUrl`), which speaks the OpenAI dialect and stamps
 * every answer with `x-publik-*` headers the ledger reads for the real charge.
 */

/**
 * Six distinct states, never a generic toast.
 *
 * Every one of these gets its own copy and its own retry policy, because "an
 * error occurred" tells a user nothing about whether to wait, pay, re-enter a
 * key, or switch paths.
 */
export type ScanFailureKind =
  | 'key-invalid'
  | 'quota-exhausted'
  | 'model-unavailable'
  | 'error-retryable'
  | 'offline'
  | 'content-refusal'
  | 'schema-violation'
  /**
   * A request that may or may not have been billed. NEVER auto-retried: no
   * provider offers an idempotency key for this endpoint, so a naive retry
   * double-bills the user for one photo.
   */
  | 'timeout-ambiguous'

export interface ScanFailure {
  kind: ScanFailureKind
  message: string
  retryable: boolean
  httpStatus?: number
  /** publik API's one link (CONTRACT §1: `top_up_url`), origin-checked at classification. */
  action?: { label: string; url: string }
  /** `401 key_revoked { reprovision: true }` — the idle sweep; one bounded re-mint is allowed. */
  reprovision?: boolean
}

export interface ScanSuccess {
  raw: unknown
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  promptVersion: string
  /** The gateway's settled charge (`x-publik-charge-micros`); null off publik. */
  chargeUsd: number | null
  /** The balance after this call, from the response headers; absent off publik. */
  wallet?: PublikWalletPatch
}

export type ScanOutcome = { ok: true; value: ScanSuccess } | { ok: false; error: ScanFailure }

export interface Credential {
  kind: 'api_key' | 'oauth'
  value: string
}

export interface ScanRequest {
  provider: ProviderId
  model: string
  credential: Credential
  imagesBase64: readonly string[]
  localSignalsBlock: string
  jsonSchema: unknown
  timeoutMs?: number
  /** Proxy origin (publik API); absent means the vendor's own host. */
  baseUrl?: string
}

const DEFAULT_TIMEOUT_MS = 45_000

/** Short, human-readable reason pulled from a provider error body (diagnostics only). */
function errorDetail(body: string): string {
  let msg = ''
  try {
    const j = JSON.parse(body)
    const m = j?.error?.message ?? j?.message
    if (typeof m === 'string') msg = m
  } catch {
    msg = body
  }
  msg = msg.replace(/\s+/g, ' ').trim()
  return msg.length > 300 ? `${msg.slice(0, 300)}...` : msg
}

function classify(status: number, body: string): ScanFailure {
  // A publik envelope names its own state and its one link; it runs before
  // the status switch so a 402 keeps the link and a 401 keeps `reprovision`.
  const gateway = classifyGatewayError(status, body)
  if (gateway) return gateway
  if (status === 401 || status === 403) {
    return { kind: 'key-invalid', message: 'Dostawca odrzucił ten klucz.', retryable: false, httpStatus: status }
  }
  if (status === 402) {
    return { kind: 'quota-exhausted', message: 'Na koncie u dostawcy skończył się kredyt.', retryable: false, httpStatus: status }
  }
  if (status === 404) {
    return { kind: 'model-unavailable', message: `Ten model nie jest dostępny na Twoim koncie. ${errorDetail(body)}`.trim(), retryable: false, httpStatus: status }
  }
  if (status === 429) {
    return { kind: 'error-retryable', message: 'Dostawca ogranicza liczbę zapytań. Spróbuj za chwilę.', retryable: true, httpStatus: status }
  }
  if (status >= 500) {
    return { kind: 'error-retryable', message: 'Dostawca zgłosił błąd serwera.', retryable: true, httpStatus: status }
  }
  if (/refus|safety|policy/i.test(body)) {
    return { kind: 'content-refusal', message: 'Dostawca odmówił analizy tego zdjęcia.', retryable: false, httpStatus: status }
  }
  return { kind: 'error-retryable', message: `Nieoczekiwana odpowiedź dostawcy (${status}). ${errorDetail(body)}`.trim(), retryable: true, httpStatus: status }
}

/** Pull the JSON payload out of each provider's differently-shaped envelope. */
function extractPayload(provider: ProviderId, json: unknown): { raw: unknown; inputTokens: number; outputTokens: number } | null {
  const j = json as Record<string, any>
  try {
    if (provider === 'anthropic') {
      const text = j.content?.[0]?.text
      return {
        raw: typeof text === 'string' ? JSON.parse(text) : text,
        inputTokens: j.usage?.input_tokens ?? 0,
        outputTokens: j.usage?.output_tokens ?? 0,
      }
    }
    if (provider === 'openai') {
      const text = j.choices?.[0]?.message?.content
      return {
        raw: typeof text === 'string' ? JSON.parse(text) : text,
        inputTokens: j.usage?.prompt_tokens ?? 0,
        outputTokens: j.usage?.completion_tokens ?? 0,
      }
    }
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text
    return {
      raw: typeof text === 'string' ? JSON.parse(text) : text,
      inputTokens: j.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: j.usageMetadata?.candidatesTokenCount ?? 0,
    }
  } catch {
    return null
  }
}

/** The metered facts a publik response carries; nothing when it is a vendor response. */
function metered(res: Response): { chargeUsd: number | null; wallet?: PublikWalletPatch } {
  if (!isPublikResponse(res.headers)) return { chargeUsd: null }
  // A PATCH, not a snapshot: this layer has no storage, so it reports only
  // what the headers named and lets the store decide what to keep.
  return { chargeUsd: chargeUsdFromHeaders(res.headers), wallet: walletPatchFromHeaders(res.headers) }
}

export async function runScan(req: ScanRequest, fetchImpl: typeof fetch = fetch): Promise<ScanOutcome> {
  const input = {
    model: req.model,
    imagesBase64: req.imagesBase64,
    localSignalsBlock: req.localSignalsBlock,
    jsonSchema: req.jsonSchema,
    ...(req.baseUrl ? { baseUrl: req.baseUrl } : {}),
  }

  const built =
    req.provider === 'anthropic'
      ? buildAnthropicRequest(input, req.credential)
      : req.provider === 'openai'
        ? buildOpenAIRequest(input, req.credential.value)
        : buildGeminiRequest(input, req.credential.value)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const started = Date.now()

  try {
    const res = await fetchImpl(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
    })

    const text = await res.text()
    if (!res.ok) return { ok: false, error: classify(res.status, text) }

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'Dostawca zwrócił uszkodzony JSON.', retryable: false } }
    }

    const extracted = extractPayload(req.provider, json)
    if (!extracted || extracted.raw == null) {
      return { ok: false, error: { kind: 'schema-violation', message: 'Dostawca zwrócił nieoczekiwany format odpowiedzi.', retryable: false } }
    }

    const m = metered(res)
    return {
      ok: true,
      value: {
        raw: extracted.raw,
        inputTokens: extracted.inputTokens,
        outputTokens: extracted.outputTokens,
        // Real token counts, never an estimate, so the ledger shows an actual
        // dollar figure rather than a guess. On publik the gateway's settled
        // charge is the figure — it knows cached-token pricing the table does not.
        costUsd: m.chargeUsd ?? computeScanCost(req.provider, req.model, extracted.inputTokens, extracted.outputTokens),
        latencyMs: Date.now() - started,
        promptVersion: built.promptVersion,
        chargeUsd: m.chargeUsd,
        ...(m.wallet ? { wallet: m.wallet } : {}),
      },
    }
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError'
    if (aborted) {
      // The request MAY have been billed. Never auto-retry — no provider offers
      // an idempotency key here, so a retry can double-charge for one photo. The
      // user is told, and chooses.
      return {
        ok: false,
        error: {
          kind: 'timeout-ambiguous',
          message: 'Upłynął limit czasu żądania. Mogło zostać naliczone, więc nie ponowimy go automatycznie.',
          retryable: false,
        },
      }
    }
    return { ok: false, error: { kind: 'offline', message: 'Brak połączenia z dostawcą.', retryable: true } }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The scan with a structural safety net.
 *
 * A provider that rejects our schema DIALECT (a structural 400, before auth or
 * billing) should not brick scanning: the same request is retried once with no
 * structured-output mode at all, relying on the prompt plus client-side Zod.
 * That retry costs nothing extra — a structurally rejected request is never
 * billed. Auth failures (401/403) and everything else pass through untouched.
 */
export async function runScanWithFallback(
  req: ScanRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ScanOutcome & { usedSchemaFallback?: boolean }> {
  const first = await runScan(req, fetchImpl)
  const structural =
    !first.ok && first.error.httpStatus === 400 && req.jsonSchema != null
  if (!structural) return first

  const second = await runScan({ ...req, jsonSchema: null }, fetchImpl)
  return second.ok ? { ...second, usedSchemaFallback: true } : first
}

/**
 * Nutrition-label transcription: one image in, one LabelPayload-shaped JSON
 * out. No tools, no structured-output mode; validated by the caller.
 */
export async function runLabelScan(
  provider: ProviderId,
  input: { model: string; imageBase64: string; baseUrl?: string },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): Promise<WebLookupOutcome> {
  return postVisionJson(provider, buildLabelScanRequest(provider, input, credential), fetchImpl, timeoutMs)
}

/** Receipt transcription: same transport, different instruction and validator. */
export async function runReceiptScan(
  provider: ProviderId,
  input: { model: string; imageBase64: string; baseUrl?: string },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): Promise<WebLookupOutcome> {
  return postVisionJson(provider, buildReceiptScanRequest(provider, input, credential), fetchImpl, timeoutMs)
}

async function postVisionJson(
  provider: ProviderId,
  built: { url: string; headers: Record<string, string>; body: unknown },
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<WebLookupOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: classify(res.status, text) }
    const m = metered(res)

    let j: Record<string, any>
    try {
      j = JSON.parse(text) as Record<string, any>
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'Dostawca zwrócił uszkodzony JSON.', retryable: false } }
    }

    let out: string | null = null
    if (provider === 'anthropic') {
      const texts = (j.content ?? []).filter((b: any) => b?.type === 'text')
      out = texts.length ? texts[texts.length - 1].text : null
    } else if (provider === 'openai') {
      out = j.choices?.[0]?.message?.content ?? null
    } else {
      out = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('') || null
    }
    if (!out) {
      return { ok: false, error: { kind: 'schema-violation', message: 'Dostawca nie zwrócił tekstu.', retryable: false } }
    }

    const fenced = out.replace(/```(?:json)?/g, '').trim()
    const start = fenced.indexOf('{')
    const end = fenced.lastIndexOf('}')
    if (start < 0 || end <= start) {
      return { ok: false, error: { kind: 'schema-violation', message: 'Brak JSON w odpowiedzi.', retryable: false } }
    }
    try {
      return { ok: true, raw: JSON.parse(fenced.slice(start, end + 1)), ...m }
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'Nie udało się sparsować JSON z odpowiedzi.', retryable: false } }
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return { ok: false, error: { kind: 'timeout-ambiguous', message: 'Skan przekroczył limit czasu.', retryable: false } }
    }
    return { ok: false, error: { kind: 'offline', message: 'Brak połączenia z dostawcą.', retryable: true } }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The web-lookup refinement call — the provider's server-side search tool.
 *
 * No structured-output mode here (it does not compose with search on every
 * provider), so the JSON is fished out of prose defensively: last text block,
 * markdown fences stripped, outermost braces isolated. The caller validates
 * with WebLookupResultZ — this function only transports.
 */
export interface WebLookupOutcome {
  ok: boolean
  raw?: unknown
  error?: ScanFailure
  /** The gateway's settled charge for this call; null or absent off publik. */
  chargeUsd?: number | null
  /** The balance after this call; absent off publik. */
  wallet?: PublikWalletPatch
}

export async function runWebLookup(
  provider: ProviderId,
  input: {
    model: string
    itemName: string
    brand: string | null
    visualContext?: string | null
    baseUrl?: string
    /** OpenAI only: false = Chat Completions without the web_search tool (publik mode). */
    webSearch?: boolean
  },
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): Promise<WebLookupOutcome> {
  const built = buildWebLookupRequest(provider, input, credential)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: classify(res.status, text) }
    const m = metered(res)

    let j: Record<string, any>
    try {
      j = JSON.parse(text) as Record<string, any>
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'Dostawca zwrócił uszkodzony JSON.', retryable: false } }
    }
    let out: string | null = null
    if (provider === 'anthropic') {
      // Content is a block ARRAY interleaving tool use and text; the answer is
      // the LAST text block, not the first.
      const texts = (j.content ?? []).filter((b: any) => b?.type === 'text')
      out = texts.length ? texts[texts.length - 1].text : null
    } else if (provider === 'openai') {
      // Responses API: output[] items; the message item holds output_text parts.
      // Chat Completions (the tool-less publik path): choices[0].message.content.
      const msg = (j.output ?? []).find((o: any) => o?.type === 'message')
      out = j.choices?.[0]?.message?.content ?? msg?.content?.map((c: any) => c?.text ?? '').join('') ?? j.output_text ?? null
    } else {
      out = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('') || null
    }
    if (!out) {
      return { ok: false, error: { kind: 'schema-violation', message: 'Dostawca nie zwrócił tekstu.', retryable: false } }
    }

    const fenced = out.replace(/```(?:json)?/g, '').trim()
    const start = fenced.indexOf('{')
    const end = fenced.lastIndexOf('}')
    if (start < 0 || end <= start) {
      return { ok: false, error: { kind: 'schema-violation', message: 'Brak JSON w odpowiedzi.', retryable: false } }
    }
    try {
      return { ok: true, raw: JSON.parse(fenced.slice(start, end + 1)), ...m }
    } catch {
      return { ok: false, error: { kind: 'schema-violation', message: 'Nie udało się sparsować JSON z odpowiedzi.', retryable: false } }
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return { ok: false, error: { kind: 'timeout-ambiguous', message: 'Wyszukiwanie przekroczyło limit czasu.', retryable: false } }
    }
    return { ok: false, error: { kind: 'offline', message: 'Brak połączenia z dostawcą.', retryable: true } }
  } finally {
    clearTimeout(timer)
  }
}
