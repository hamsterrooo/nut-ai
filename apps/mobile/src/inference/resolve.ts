import { cheapestModel, type Credential, type ProviderId } from '@nutai/prompt'
import { setting } from '../data/repo'
import { loadCredential } from './credentials'

/**
 * One resolver for every call site that used to read `provider`,
 * `loadCredential` and `provider_model` by hand.
 *
 * BYO key only: the provider setting is the wire dialect and the credential is
 * the key the user pasted for it.
 */

export type ProviderSetting = ProviderId | 'none' | ''

export interface Resolved {
  /** The provider the user chose; also the wire dialect. */
  provider: ProviderId
  model: string
  credential: Credential
}

export type ResolveFailure = { kind: 'no-key' | 'key-missing' }

export type ResolveOutcome = { ok: true; value: Resolved } | { ok: false; error: ResolveFailure }

export async function resolveInference(): Promise<ResolveOutcome> {
  const provider = (await setting('provider')) as ProviderSetting
  if (!provider || provider === 'none') return { ok: false, error: { kind: 'no-key' } }

  const credential = await loadCredential(provider)
  if (!credential) return { ok: false, error: { kind: 'key-missing' } }
  const model = (await setting('provider_model')) || cheapestModel(provider).id
  return { ok: true, value: { provider, model, credential } }
}
