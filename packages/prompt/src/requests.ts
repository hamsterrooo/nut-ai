import { SYSTEM_PROMPT, PROMPT_VERSION } from './system-prompt.js'
import { LABEL_SCAN_INSTRUCTION, LABEL_SCAN_PROMPT_VERSION } from './label-scan.js'
import type { ProviderId } from './providers.js'

/**
 * Provider wire formats.
 *
 * One request shape (optional system prompt, images, one text part, optional
 * structured-output schema) emitted in three dialects. This module builds
 * request BODIES only: no I/O, no credentials storage, nothing platform-specific,
 * so the eval harness can diff the exact bytes each provider would receive.
 *
 *   Anthropic  a normal API key uses `x-api-key`; a `claude setup-token`
 *              credential is a bearer token that additionally REQUIRES the
 *              `anthropic-beta` OAuth header, or the endpoint 401s on a valid token.
 *   OpenAI     strict structured output needs every property in `required`.
 *   Gemini     accepts a looser schema shape.
 */

export interface Credential {
  kind: 'api_key' | 'oauth'
  value: string
}

export interface ProviderRequest {
  url: string
  headers: Record<string, string>
  body: unknown
  promptVersion: string
}

export const PROVIDER_ORIGIN: Record<ProviderId, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  google: 'https://generativelanguage.googleapis.com',
}

export const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20'
export const ANTHROPIC_VERSION = '2023-06-01'

const JSON_HEADER = { 'content-type': 'application/json' }

export function anthropicHeaders(kind: Credential['kind'], value: string): Record<string, string> {
  return kind === 'api_key'
    ? { 'x-api-key': value, 'anthropic-version': ANTHROPIC_VERSION, ...JSON_HEADER }
    : {
        authorization: `Bearer ${value}`,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': ANTHROPIC_OAUTH_BETA,
        ...JSON_HEADER,
      }
}

function headersFor(provider: ProviderId, credential: Credential): Record<string, string> {
  if (provider === 'anthropic') return anthropicHeaders(credential.kind, credential.value)
  if (provider === 'openai') return { authorization: `Bearer ${credential.value}`, ...JSON_HEADER }
  return { 'x-goog-api-key': credential.value, ...JSON_HEADER }
}

function urlFor(provider: ProviderId, model: string): string {
  const origin = PROVIDER_ORIGIN[provider]
  if (provider === 'anthropic') return `${origin}/v1/messages`
  if (provider === 'openai') return `${origin}/v1/chat/completions`
  return `${origin}/v1beta/models/${encodeURIComponent(model)}:generateContent`
}

interface WireCall {
  model: string
  system?: string
  /** Base64 JPEGs, already resized and EXIF-baked. */
  imagesBase64: readonly string[]
  text: string
  maxTokens: number
  /**
   * The provider-dialect wire schema, or null for plain JSON mode: the prompt
   * demands bare JSON and the caller validates with Zod. Null is also the retry
   * path when a provider rejects the schema dialect with a structural 400.
   */
  jsonSchema: unknown
  promptVersion: string
}

function buildRequest(provider: ProviderId, credential: Credential, call: WireCall): ProviderRequest {
  const { model, system, imagesBase64, text, maxTokens, jsonSchema, promptVersion } = call
  const url = urlFor(provider, model)
  const headers = headersFor(provider, credential)

  if (provider === 'anthropic') {
    const content: unknown[] = imagesBase64.map((data) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data },
    }))
    content.push({ type: 'text', text })
    return {
      url,
      headers,
      body: {
        model,
        max_tokens: maxTokens,
        ...(system === undefined ? {} : { system }),
        messages: [{ role: 'user', content }],
        ...(jsonSchema == null ? {} : { output_config: { format: { type: 'json_schema', schema: jsonSchema } } }),
      },
      promptVersion,
    }
  }

  if (provider === 'openai') {
    const content: unknown[] = imagesBase64.map((data) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${data}` },
    }))
    content.push({ type: 'text', text })
    return {
      url,
      headers,
      body: {
        model,
        max_tokens: maxTokens,
        messages: [...(system === undefined ? [] : [{ role: 'system', content: system }]), { role: 'user', content }],
        response_format:
          jsonSchema == null
            ? { type: 'json_object' }
            : { type: 'json_schema', json_schema: { name: 'VisionPayload', strict: true, schema: jsonSchema } },
      },
      promptVersion,
    }
  }

  const parts: unknown[] = imagesBase64.map((data) => ({ inline_data: { mime_type: 'image/jpeg', data } }))
  parts.push({ text })
  return {
    url,
    headers,
    body: {
      ...(system === undefined ? {} : { system_instruction: { parts: [{ text: system }] } }),
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(jsonSchema == null ? {} : { responseSchema: jsonSchema }),
        maxOutputTokens: maxTokens,
      },
    },
    promptVersion,
  }
}

const USER_INSTRUCTION = 'Analyze the meal in the attached photo(s) and respond with only the JSON object.'

const USER_INSTRUCTION_TEXT =
  'There is no photo. The meal is described in words in the user note above. Analyze that description and respond with only the JSON object. Treat the described foods as the items, use any stated grams or household measures, set visible_reference_objects to an empty array and container to null, and state in stated_assumptions every portion you had to assume.'

const SCAN_MAX_TOKENS: Record<ProviderId, number> = { anthropic: 4096, openai: 4096, google: 8192 }
const LABEL_MAX_TOKENS = 1024

export interface ScanRequestInput {
  model: string
  imagesBase64: readonly string[]
  /** The labeled user-context block, or empty string. */
  localSignalsBlock: string
  jsonSchema: unknown
  /** No photo: the meal is described in words in the local-signals block. */
  textOnly?: boolean
}

/** The meal scan: system prompt, per-scan context in the USER turn, structured output. */
export function buildScanRequest(provider: ProviderId, credential: Credential, input: ScanRequestInput): ProviderRequest {
  const instruction = input.textOnly === true ? USER_INSTRUCTION_TEXT : USER_INSTRUCTION
  return buildRequest(provider, credential, {
    model: input.model,
    system: SYSTEM_PROMPT,
    imagesBase64: input.imagesBase64,
    text: input.localSignalsBlock ? `${input.localSignalsBlock}\n\n${instruction}` : instruction,
    maxTokens: SCAN_MAX_TOKENS[provider],
    jsonSchema: input.jsonSchema,
    promptVersion: PROMPT_VERSION,
  })
}

/** Nutrition-label transcription: one image, plain JSON mode, validated by LabelPayloadZ. */
export function buildLabelScanRequest(
  provider: ProviderId,
  credential: Credential,
  input: { model: string; imageBase64: string },
): ProviderRequest {
  return buildRequest(provider, credential, {
    model: input.model,
    imagesBase64: [input.imageBase64],
    text: LABEL_SCAN_INSTRUCTION,
    maxTokens: LABEL_MAX_TOKENS,
    jsonSchema: null,
    promptVersion: LABEL_SCAN_PROMPT_VERSION,
  })
}
