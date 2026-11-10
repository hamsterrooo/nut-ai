import { describe, expect, it } from 'vitest'
import {
  buildLabelScanRequest, buildLocalSignalsBlock, buildScanRequest, cheapestModel, computeScanCost,
  PROMPT_VERSION, providersByPrice, PROVIDER_MODELS, SYSTEM_PROMPT,
} from './index.js'

const base = {
  model: 'x', imagesBase64: ['AAAA'], localSignalsBlock: '', jsonSchema: { type: 'object' },
}
const key = { kind: 'api_key' as const, value: 'k' }

describe('the system prompt', () => {
  it('embeds its own version, so no scan can be logged without knowing its prompt', () => {
    expect(SYSTEM_PROMPT).toContain(`<prompt_version>${PROMPT_VERSION}</prompt_version>`)
  })

  it('frames the model as a perception device, not a calculator', () => {
    expect(SYSTEM_PROMPT).toMatch(/PERCEPTION device, not a calculator/)
  })

  it('states the sanity bounds that are the first line of defence against absurd output', () => {
    expect(SYSTEM_PROMPT).toMatch(/900 kcal\/100g/)
    expect(SYSTEM_PROMPT).toMatch(/2,500 kcal/)
  })

  it('requires identification and portion confidence to be reported separately', () => {
    expect(SYSTEM_PROMPT).toMatch(/SEPARATELY/)
  })

  it('demands composite dishes decompose into per-component items', () => {
    expect(SYSTEM_PROMPT).toMatch(/one item PER COMPONENT/)
    expect(SYSTEM_PROMPT).toMatch(/"cheeseburger" as a single\s+item is WRONG/)
  })

  it('tells the model to name hidden oil every single time', () => {
    expect(SYSTEM_PROMPT).toMatch(/stated_assumptions every single time/)
  })

  it('asks for companion drinks, whose omission is a 100% error on that item', () => {
    expect(SYSTEM_PROMPT).toMatch(/COMPANION DRINKS/)
  })

  it('specifies USDA-style keys, which is an IR lever rather than a style preference', () => {
    expect(SYSTEM_PROMPT).toMatch(/chicken breast, grilled/)
  })
})

describe('local signals', () => {
  it('is empty when there is nothing to say, rather than emitting a stub block', () => {
    expect(buildLocalSignalsBlock({})).toBe('')
  })

  it('labels the block as information, not instruction', () => {
    const b = buildLocalSignalsBlock({ userHint: 'leftovers' })
    expect(b).toMatch(/<user_context>/)
    expect(b).toMatch(/not instruction/)
  })

  it('includes the user’s own calibrated containers', () => {
    const b = buildLocalSignalsBlock({
      knownContainers: [{ label: 'my cereal bowl', type: 'cereal_bowl', usableMl: 480 }],
    })
    expect(b).toMatch(/my cereal bowl/)
    expect(b).toMatch(/480 ml/)
  })
})

describe('provider wire formats', () => {
  it('uses x-api-key for an Anthropic API key and Bearer for a setup token', () => {
    const k = buildScanRequest('anthropic', { kind: 'api_key', value: 'sk-ant-x' }, base)
    const o = buildScanRequest('anthropic', { kind: 'oauth', value: 'tok' }, base)
    expect(k.headers['x-api-key']).toBe('sk-ant-x')
    expect(k.headers['authorization']).toBeUndefined()
    expect(k.headers['anthropic-beta']).toBeUndefined()
    expect(o.headers['authorization']).toBe('Bearer tok')
    expect(o.headers['x-api-key']).toBeUndefined()
    // A setup-token 401s on /v1/messages without this, even when valid.
    expect(o.headers['anthropic-beta']).toBe('oauth-2025-04-20')
  })

  it('puts the system prompt in the system field for every provider', () => {
    const a = buildScanRequest('anthropic', key, base).body as any
    const g = buildScanRequest('google', key, base).body as any
    const o = buildScanRequest('openai', key, base).body as any
    expect(a.system).toBe(SYSTEM_PROMPT)
    expect(g.system_instruction.parts[0].text).toBe(SYSTEM_PROMPT)
    expect(o.messages[0].content).toBe(SYSTEM_PROMPT)
  })

  it('keeps per-scan context in the USER turn so the cached prefix stays stable', () => {
    const withCtx = { ...base, localSignalsBlock: '<user_context>hi</user_context>' }
    const a = buildScanRequest('anthropic', key, withCtx).body as any
    expect(a.system).toBe(SYSTEM_PROMPT)
    expect(JSON.stringify(a.messages)).toContain('user_context')
  })

  it('requests strict structured output from OpenAI', () => {
    const o = buildScanRequest('openai', key, base).body as any
    expect(o.response_format.json_schema.strict).toBe(true)
  })

  it('records the prompt version on every request', () => {
    for (const p of ['anthropic', 'openai', 'google'] as const) {
      expect(buildScanRequest(p, key, base).promptVersion).toBe(PROMPT_VERSION)
    }
  })

  it('a null schema is plain JSON mode: no structured-output field on any provider', () => {
    const plain = { ...base, jsonSchema: null }
    expect((buildScanRequest('anthropic', key, plain).body as any).output_config).toBeUndefined()
    expect((buildScanRequest('openai', key, plain).body as any).response_format).toEqual({ type: 'json_object' })
    expect((buildScanRequest('google', key, plain).body as any).generationConfig.responseSchema).toBeUndefined()
  })

  it('a text-only scan carries no image part', () => {
    const o = buildScanRequest('openai', key, { ...base, imagesBase64: [], textOnly: true }).body as any
    expect(o.messages[1].content).toHaveLength(1)
    expect(o.messages[1].content[0].type).toBe('text')
  })

  it('sends every request to the vendor host', () => {
    expect(buildScanRequest('anthropic', key, base).url).toBe('https://api.anthropic.com/v1/messages')
    expect(buildScanRequest('openai', key, base).url).toBe('https://api.openai.com/v1/chat/completions')
    expect(buildScanRequest('google', key, base).url).toBe('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')
    const label = { model: 'x', imageBase64: 'AAAA' }
    expect(buildLabelScanRequest('anthropic', key, label).url).toBe('https://api.anthropic.com/v1/messages')
    expect(buildLabelScanRequest('openai', key, label).url).toBe('https://api.openai.com/v1/chat/completions')
    expect(buildLabelScanRequest('google', key, label).url).toBe('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')
  })

  it('a label scan has no system prompt and its own prompt version', () => {
    const o = buildLabelScanRequest('openai', key, { model: 'x', imageBase64: 'AAAA' })
    expect((o.body as any).messages).toHaveLength(1)
    expect(o.promptVersion).not.toBe(PROMPT_VERSION)
  })
})

describe('the provider picker is neutral', () => {
  it('sorts by price with no recommended badge anywhere', () => {
    const order = providersByPrice()
    const costs = order.map((p) => Math.min(...PROVIDER_MODELS[p].map((m) => m.approxScanCostUsd)))
    expect([...costs].sort((a, b) => a - b)).toEqual(costs)
  })

  it('pre-selects the cheapest vision model within a provider', () => {
    for (const p of providersByPrice()) {
      const cheapest = cheapestModel(p)
      for (const m of PROVIDER_MODELS[p]) {
        expect(cheapest.approxScanCostUsd).toBeLessThanOrEqual(m.approxScanCostUsd)
      }
    }
  })
})

describe('cost', () => {
  it('computes from real token counts, not an estimate', () => {
    const c = computeScanCost('anthropic', 'claude-haiku-4-5-20251001', 1500, 800)
    expect(c).toBeCloseTo((1500 / 1e6) * 1 + (800 / 1e6) * 5, 9)
  })

  it('returns zero for an unknown model rather than inventing a price', () => {
    expect(computeScanCost('openai', 'not-a-model', 1000, 1000)).toBe(0)
  })
})

describe('Polish locale prompts', () => {
  it('keeps canonical_food_key English and asks for Polish user-facing text', () => {
    expect(SYSTEM_PROMPT).toMatch(/canonical_food_key\` stays ENGLISH/)
    expect(SYSTEM_PROMPT).toMatch(/natural, brief Polish/)
  })
  it('label prompt asks for salt and kJ instead of sodium arithmetic', async () => {
    const { LABEL_SCAN_INSTRUCTION } = await import('./label-scan.js')
    expect(LABEL_SCAN_INSTRUCTION).toMatch(/salt_g/)
    expect(LABEL_SCAN_INSTRUCTION).toMatch(/energy_kj/)
    expect(LABEL_SCAN_INSTRUCTION).toMatch(/per-100 g/)
  })
})
