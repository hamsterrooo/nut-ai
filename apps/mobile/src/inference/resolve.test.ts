import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The resolver against mocked stores: the provider setting picks the wire
 * dialect, the stored key is the credential, and a chosen model is honoured.
 */

const settings = new Map<string, string>()
const creds = new Map<string, { kind: 'api_key' | 'oauth'; value: string }>()

vi.mock('../data/repo', () => ({
  setting: async (k: string, fallback = '') => settings.get(k) ?? fallback,
}))
vi.mock('./credentials', () => ({
  loadCredential: async (slot: string) => creds.get(slot) ?? null,
}))

import { resolveInference } from './resolve'

beforeEach(() => {
  settings.clear()
  creds.clear()
})

describe('resolveInference', () => {
  it('no provider → no-key', async () => {
    expect(await resolveInference()).toEqual({ ok: false, error: { kind: 'no-key' } })
    settings.set('provider', 'none')
    expect(await resolveInference()).toEqual({ ok: false, error: { kind: 'no-key' } })
  })

  it('a vendor with a key resolves to its own dialect and cheapest model', async () => {
    settings.set('provider', 'openai')
    creds.set('openai', { kind: 'api_key', value: 'sk-vendor' })
    const r = await resolveInference()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.dialect).toBe('openai')
      expect(r.value.selected).toBe('openai')
      expect(r.value.model).toBe('gpt-4o-mini')
      expect(r.value.textModel).toBe('gpt-4o-mini')
      expect(r.value.credential.value).toBe('sk-vendor')
    }
  })

  it('a chosen provider_model is honoured for scans and text calls', async () => {
    settings.set('provider', 'openai')
    settings.set('provider_model', 'gpt-4o')
    creds.set('openai', { kind: 'api_key', value: 'sk-vendor' })
    const r = await resolveInference()
    expect(r.ok && r.value.model).toBe('gpt-4o')
    expect(r.ok && r.value.textModel).toBe('gpt-4o')
  })

  it('a vendor setting with no key → key-missing', async () => {
    settings.set('provider', 'anthropic')
    expect(await resolveInference()).toEqual({ ok: false, error: { kind: 'key-missing' } })
  })
})
