import { buildVisionJsonRequest } from './vision-json.js'
import type { ProviderId, ProviderRequest } from './providers.js'

/**
 * Receipt transcription — the meal you didn't photograph.
 *
 * The model's ONLY job is reading the paper: merchant and food line items.
 * Nutrition comes afterwards from the web-lookup machinery, one search per
 * item with the merchant as the brand, so every number traces to published
 * facts rather than to what a model thinks a "LG FRY" weighs.
 */

export const RECEIPT_SCAN_PROMPT_VERSION = 'receipt-scan-v2-pl'

export const RECEIPT_SCAN_INSTRUCTION = [
  'The photo shows a purchase receipt from Poland (paragon fiskalny, in Polish; a restaurant rachunek or a store receipt). TRANSCRIBE the food and drink line items — copy what is printed, expanding obvious receipt abbreviations ("MLEKO UHT 3,2% 1L" stays as is, "JOG.NAT.PIATN." -> "Jogurt naturalny Piątnica", "CHLEB WIEJSKI KROJ." -> "Chleb wiejski krojony") but never guessing beyond the print.',
  '',
  'Rules:',
  '- merchant: the restaurant or store name from the receipt header (e.g. "Biedronka", "Żabka", "McDonald\'s", "Pizzeria ..."), or null.',
  '- items: FOOD AND DRINK ONLY. Skip PTU/VAT lines (the letters A, B, C, D after a price are tax rates, not products), totals ("SUMA PLN", "RAZEM"), rabaty (discounts), kaucja (deposits), torba/reklamówka (bags), delivery and non-food merchandise.',
  '- Keep each item name in Polish exactly as printed or lightly expanded; do not translate it.',
  '- quantity from the printed qty column ("2 x 3,99" means quantity 2, "0,456 kg" for loose produce means quantity 1); 1 when none is printed.',
  '- Combine identical lines by summing quantity.',
  '- A combo or set line expands to its standard parts only when the receipt itself does not itemize them ("Zestaw Big Mac" -> Big Mac, Frytki średnie, Napój średni).',
  '- If the photo is not a legible receipt, return {"merchant": null, "items": []}.',
  '',
  'Respond with ONLY this JSON object:',
  '{"merchant": string|null, "items": [{"name": string, "quantity": number}]}',
].join('\n')

export function buildReceiptScanRequest(
  provider: ProviderId,
  input: { model: string; imageBase64: string; baseUrl?: string },
  credential: { kind: 'api_key' | 'oauth'; value: string },
): ProviderRequest {
  return buildVisionJsonRequest(
    provider,
    { ...input, instruction: RECEIPT_SCAN_INSTRUCTION, maxTokens: 1024 },
    credential,
    RECEIPT_SCAN_PROMPT_VERSION,
  )
}
