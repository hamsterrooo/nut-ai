import { ANTHROPIC_BASE_URL, ANTHROPIC_OAUTH_BETA, GEMINI_BASE_URL, joinUrl, OPENAI_BASE_URL } from './providers.js'
import type { ProviderId, ProviderRequest } from './providers.js'

/**
 * Nutrition-label transcription requests.
 *
 * One image, one instruction, no tools, no structured-output mode — the JSON is
 * validated client-side by LabelPayloadZ. The instruction is explicit that this
 * is COPYING, because the failure mode worth designing against is a model
 * "helpfully" normalizing a label's numbers to what it believes they should be.
 */

export const LABEL_SCAN_PROMPT_VERSION = 'label-scan-v2-pl'

export const LABEL_SCAN_INSTRUCTION = [
  'The photo shows a printed nutrition label from a product sold in Poland (EU format, usually Polish: "Wartość odżywcza", "Informacja żywieniowa"). TRANSCRIBE it — copy the numbers exactly as printed. Do not estimate, correct, or normalize anything, even if a printed value looks wrong to you.',
  '',
  'Polish label vocabulary: Energia (kJ / kcal), Tłuszcz, w tym kwasy tłuszczowe nasycone, Węglowodany, w tym cukry, Błonnik, Białko, Sól. "Na 100 g" / "w 100 g" / "na 100 ml" is the reference column; "na porcję" / "w porcji" / "1 porcja (30 g)" is the serving column.',
  '',
  'Rules:',
  '- Which column: if the label prints a per-serving column AND the gram weight of that serving, use the per-serving column, set serving_g to that weight and serving_desc to the printed text (e.g. "1 porcja (30 g)"). Otherwise use the per-100 g (or per-100 ml) column, set serving_g to 100 and serving_desc to "100 g" (or "100 ml"). Never mix columns.',
  '- Energy: calories_kcal is the kcal figure. If only kJ is printed, set calories_kcal to 0 and put the kJ in energy_kj; the app converts it. If both are printed, fill both.',
  '- Salt: the EU panel prints SALT (Sól) in grams, not sodium. Put it in salt_g exactly as printed and leave sodium_mg null. Only fill sodium_mg if the label itself prints sodium (Sód).',
  '- "Fat, of which saturates" and "Carbohydrate, of which sugars": fat_g is TOTAL fat and carbs_g is TOTAL carbohydrate; the "w tym" lines are sub-items, never added on top. sugar_g is the "w tym cukry" line.',
  '- Polish decimals use a comma: "3,5" means 3.5. A "<" value (e.g. "<0,5") is copied as its upper bound number.',
  '- serving_g is only a gram figure printed with the serving or the 100 g reference; never infer one from the net weight of the package.',
  '- A nutrient the label does not list is null. A printed 0 is 0. These are different.',
  '- product_name only if a product name is visible in the photo, copied as printed; otherwise null.',
  '- If the photo does not show a legible nutrition label, set every field to null and per_serving values to 0.',
  '',
  'Respond with ONLY this JSON object:',
  '{"product_name": string|null, "serving_desc": string|null, "serving_g": number|null, "servings_per_container": number|null, "per_serving": {"calories_kcal": number, "energy_kj": number|null, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number|null, "sugar_g": number|null, "sodium_mg": number|null, "salt_g": number|null}}',
].join('\n')

export interface LabelScanInput {
  model: string
  imageBase64: string
  /** Proxy origin; absent means the vendor's own host. */
  baseUrl?: string
}

export function buildLabelScanRequest(
  provider: ProviderId,
  input: LabelScanInput,
  credential: { kind: 'api_key' | 'oauth'; value: string },
): ProviderRequest {
  if (provider === 'anthropic') {
    const headers: Record<string, string> =
      credential.kind === 'api_key'
        ? { 'x-api-key': credential.value, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
        : {
            authorization: `Bearer ${credential.value}`,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': ANTHROPIC_OAUTH_BETA,
            'content-type': 'application/json',
          }
    return {
      url: joinUrl(input.baseUrl ?? ANTHROPIC_BASE_URL, '/v1/messages'),
      headers,
      body: {
        model: input.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input.imageBase64 } },
              { type: 'text', text: LABEL_SCAN_INSTRUCTION },
            ],
          },
        ],
      },
      promptVersion: LABEL_SCAN_PROMPT_VERSION,
    }
  }

  if (provider === 'openai') {
    return {
      url: joinUrl(input.baseUrl ?? OPENAI_BASE_URL, '/v1/chat/completions'),
      headers: { authorization: `Bearer ${credential.value}`, 'content-type': 'application/json' },
      body: {
        model: input.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${input.imageBase64}` } },
              { type: 'text', text: LABEL_SCAN_INSTRUCTION },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      },
      promptVersion: LABEL_SCAN_PROMPT_VERSION,
    }
  }

  return {
    url: joinUrl(input.baseUrl ?? GEMINI_BASE_URL, `/v1beta/models/${encodeURIComponent(input.model)}:generateContent`),
    headers: { 'x-goog-api-key': credential.value, 'content-type': 'application/json' },
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: input.imageBase64 } },
            { text: LABEL_SCAN_INSTRUCTION },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1024 },
    },
    promptVersion: LABEL_SCAN_PROMPT_VERSION,
  }
}
