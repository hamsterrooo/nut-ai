import { describe, expect, it } from 'vitest'
import { stampSchemaVersion } from './stamp-schema-version'

describe('stampSchemaVersion', () => {
  it('adds the version when missing', () => {
    expect(stampSchemaVersion({ is_food: true })).toEqual({ is_food: true, schema_version: '1.0.0' })
  })

  it('overwrites a wrong version and does not mutate the input', () => {
    const input = { schema_version: '9', is_food: false }
    expect(stampSchemaVersion(input)).toEqual({ schema_version: '1.0.0', is_food: false })
    expect(input.schema_version).toBe('9')
  })

  it('leaves non-objects untouched so validation reports them', () => {
    expect(stampSchemaVersion('x')).toBe('x')
    expect(stampSchemaVersion(null)).toBeNull()
    expect(stampSchemaVersion([1])).toEqual([1])
  })
})
