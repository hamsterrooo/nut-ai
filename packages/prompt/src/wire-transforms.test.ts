import { describe, expect, it } from 'vitest'
import { VISION_WIRE_SCHEMA } from '@nutai/core-schema'
import { anthropicWireSchema, geminiWireSchema, openAiWireSchema } from './wire-transforms.js'

/**
 * These tests assert each provider's DOCUMENTED structural constraints against
 * the real generated schema — not a fixture — so "zod schema changed and now a
 * provider 400s" is caught here instead of as a mystery failure on device.
 */

type Node = Record<string, unknown>
const isObj = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v)

function collectNodes(root: unknown): Node[] {
  const out: Node[] = []
  const stack: unknown[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (Array.isArray(n)) {
      stack.push(...n)
      continue
    }
    if (!isObj(n)) continue
    out.push(n)
    for (const [k, v] of Object.entries(n)) {
      if (k === 'properties' && isObj(v)) stack.push(...Object.values(v))
      else if (typeof v === 'object') stack.push(v)
    }
  }
  return out
}

const BOUNDS = ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format', 'multipleOf']

describe('the base wire schema', () => {
  it('is generated from the Zod source of truth and describes the payload', () => {
    const props = (VISION_WIRE_SCHEMA as Node)['properties'] as Node
    expect(props).toBeTruthy()
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['schema_version', 'is_food', 'items', 'meal_overall']),
    )
  })

  it('contains no $ref — every provider dialect requires inlined schemas', () => {
    expect(JSON.stringify(VISION_WIRE_SCHEMA)).not.toContain('"$ref"')
  })
})

describe('openAiWireSchema (strict mode)', () => {
  const s = openAiWireSchema(VISION_WIRE_SCHEMA)
  const nodes = collectNodes(s)

  it('marks every object node additionalProperties:false with ALL keys required', () => {
    const objects = nodes.filter((n) => n['type'] === 'object' && isObj(n['properties']))
    expect(objects.length).toBeGreaterThan(3)
    for (const o of objects) {
      expect(o['additionalProperties']).toBe(false)
      expect((o['required'] as string[]).sort()).toEqual(Object.keys(o['properties'] as Node).sort())
    }
  })

  it('carries no bounds — those are enforced by the client-side Zod validator', () => {
    for (const n of nodes) for (const b of BOUNDS) expect(n).not.toHaveProperty(b)
  })
})

describe('anthropicWireSchema', () => {
  const nodes = collectNodes(anthropicWireSchema(VISION_WIRE_SCHEMA))

  it('strips bounds and pattern, which Anthropic structured outputs reject', () => {
    for (const n of nodes) for (const b of BOUNDS) expect(n).not.toHaveProperty(b)
  })

  it('drops the $schema meta key', () => {
    expect(anthropicWireSchema(VISION_WIRE_SCHEMA)).not.toHaveProperty('$schema')
  })
})

describe('geminiWireSchema (OpenAPI subset)', () => {
  const nodes = collectNodes(geminiWireSchema(VISION_WIRE_SCHEMA))

  it('never uses a type array containing null — nullability is `nullable: true`', () => {
    for (const n of nodes) {
      if (Array.isArray(n['type'])) expect(n['type']).not.toContain('null')
    }
  })

  it('carries no additionalProperties or bounds', () => {
    for (const n of nodes) {
      expect(n).not.toHaveProperty('additionalProperties')
      for (const b of BOUNDS) expect(n).not.toHaveProperty(b)
    }
  })

  it('has no `const` (not in the Gemini Schema); a literal becomes a one-element enum', () => {
    for (const n of nodes) expect(n).not.toHaveProperty('const')
    const root = geminiWireSchema(VISION_WIRE_SCHEMA) as { properties: Record<string, { enum?: unknown[] }> }
    expect(root.properties['schema_version']?.enum).toEqual(['1.0.0'])
  })
})
