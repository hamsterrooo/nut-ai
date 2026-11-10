import { anthropicHeaders, PROVIDER_ORIGIN, type Credential, type ProviderId } from '@nutai/prompt'
import { classify, type ScanFailure } from './client'

/**
 * Credential validation.
 *
 * THE BUG THIS FILE REPLACES: the first version validated by sending the real
 * scan request with an empty image list and a placeholder `{ type: 'object' }`
 * schema. That fails for structural reasons before authentication is ever
 * considered — OpenAI's strict mode requires `additionalProperties: false` plus
 * an explicit `required` array, Gemini rejects an empty response schema, and
 * Anthropic's structured-output mode wants a real schema too. Every provider
 * returned 400, which got reported as "your key was rejected". Valid keys failed.
 *
 * For OpenAI and Google the probe is the MODEL RETRIEVE endpoint: free,
 * non-billing, and answers both questions that matter in one call — does this
 * credential authenticate, and does this account actually have this model.
 *
 * Anthropic needs more care, because it accepts two credential shapes and they
 * probe DIFFERENT endpoints:
 *
 *   - console API key       -> `x-api-key` against GET /v1/models/{id} (free)
 *   - `claude setup-token`  -> `Authorization: Bearer` + the OAuth beta header
 *                              against a 1-token POST /v1/messages
 *
 * The bearer probe deliberately uses /v1/messages — the endpoint scans actually
 * hit — because a setup-token's scopes are for inference, and whether some OTHER
 * endpoint accepts them is exactly the kind of guess that produced the last bug.
 * A pass here means the scan request will authenticate, full stop. Cost is one
 * output token, drawn from the subscription for setup-tokens.
 *
 * Both shapes are tried in either order (wrong-tab pastes are the most common
 * mistake), and EVERY attempt's status+body lands in `detail` — an earlier
 * version kept only the last attempt, which hid the bearer failure behind the
 * x-api-key fallback's 401 and made the real problem invisible in the UI.
 */

export interface ValidationOk {
  ok: true
  /** Which header shape the provider actually accepted. */
  usedShape: 'x-api-key' | 'bearer' | 'query-param'
  modelId: string
}

export interface ValidationErr {
  ok: false
  error: ScanFailure
  /** Raw status and body snippet. Surfaced in the UI so failures are diagnosable. */
  detail: string
}

export type ValidationResult = ValidationOk | ValidationErr

type Shape = ValidationOk['usedShape']

interface Probe {
  shape: Shape
  url: string
  headers: Record<string, string>
  /** Absent means GET. */
  body?: unknown
}

const PROVIDER_NAME: Record<ProviderId, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' }

async function attempt(
  probe: Probe,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ status: number; body: string } | { aborted: true } | { offline: true }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(probe.url, {
      method: probe.body === undefined ? 'GET' : 'POST',
      headers: probe.headers,
      body: probe.body === undefined ? undefined : JSON.stringify(probe.body),
      signal: controller.signal,
    })
    const body = await res.text()
    return { status: res.status, body: body.slice(0, 400) }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { aborted: true }
    return { offline: true }
  } finally {
    clearTimeout(timer)
  }
}

function probesFor(provider: ProviderId, model: string, credential: Credential): Probe[] {
  const origin = PROVIDER_ORIGIN[provider]
  const id = encodeURIComponent(model)
  if (provider === 'openai') {
    return [{ shape: 'bearer', url: `${origin}/v1/models/${id}`, headers: { authorization: `Bearer ${credential.value}` } }]
  }
  if (provider === 'google') {
    return [{ shape: 'query-param', url: `${origin}/v1beta/models/${id}`, headers: { 'x-goog-api-key': credential.value } }]
  }

  // Each Anthropic shape probes differently. x-api-key: free GET on the
  // model-retrieve endpoint. bearer: a 1-token POST to /v1/messages, because that
  // is the endpoint scans use and the only one a setup-token is guaranteed scoped for.
  const apiKey: Probe = {
    shape: 'x-api-key',
    url: `${origin}/v1/models/${id}`,
    headers: anthropicHeaders('api_key', credential.value),
  }
  const bearer: Probe = {
    shape: 'bearer',
    url: `${origin}/v1/messages`,
    headers: anthropicHeaders('oauth', credential.value),
    body: { model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] },
  }
  // A credential pasted into the wrong tab is the single most common mistake
  // here, so the other shape is always tried before blaming the user.
  return credential.kind === 'oauth' ? [bearer, apiKey] : [apiKey, bearer]
}

export async function validateCredential(
  provider: ProviderId,
  model: string,
  credential: Credential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<ValidationResult> {
  const probes = probesFor(provider, model, credential)
  const details: string[] = []

  for (const probe of probes) {
    const r = await attempt(probe, fetchImpl, timeoutMs)
    if ('offline' in r) {
      return {
        ok: false,
        error: { kind: 'offline', message: `Brak połączenia z ${PROVIDER_NAME[provider]}.`, retryable: true },
        detail: 'Żądanie sieciowe nie dotarło do dostawcy.',
      }
    }
    if ('aborted' in r) {
      return {
        ok: false,
        error: { kind: 'timeout-ambiguous', message: 'Sprawdzanie przekroczyło limit czasu.', retryable: false },
        detail: `Brak odpowiedzi w ciągu ${timeoutMs / 1000} s.`,
      }
    }
    if (r.status >= 200 && r.status < 300) return { ok: true, usedShape: probe.shape, modelId: model }

    const line = `HTTP ${r.status} — ${r.body}`
    details.push(probes.length > 1 ? `${probe.shape}: ${line}` : line)
    // A 404 means auth worked but the model is wrong, so trying the other
    // header shape cannot help. With one probe, whatever came back is the answer.
    if (probes.length === 1 || r.status === 404) {
      return { ok: false, error: classify(r.status, r.body), detail: details.join('\n') }
    }
  }
  return { ok: false, error: classify(401, details.join('\n')), detail: details.join('\n') }
}
