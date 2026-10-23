import { router } from 'expo-router'
import { useState } from 'react'
import { type ProviderId } from '@nutai/prompt'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { CredentialForm, PROVIDER_NAME } from '../../src/components/CredentialForm'
import { putSetting } from '../../src/data/repo'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'

/**
 * Key entry during onboarding — a thin shell around the shared CredentialForm,
 * which owns the two Anthropic credential shapes, the six named failure
 * states, and the persistence of provider/provider_model. The SAME component
 * runs in Settings, so "works in onboarding, broken in settings" cannot
 * happen by drift.
 */
export default function ApiKeyScreen() {
  const a = useAnswers()
  const [saved, setSaved] = useState(false)

  const provider = (a.provider && a.provider !== 'none' ? a.provider : 'anthropic') as ProviderId

  return (
    <OnboardingScreen
      step={stepIndex('apikey')}
      total={TOTAL_STEPS}
      title={`Połącz ${PROVIDER_NAME[provider]}`}
      subtitle={`Sprawdzimy, czy klucz działa, zanim go zapiszemy. Jest przechowywany w pęku kluczy iOS i wysyłany wyłącznie do ${PROVIDER_NAME[provider]}.`}
      cta="Dalej"
      onCta={() => router.push(nextRoute('apikey') as never)}
      ctaDisabled={!saved}
      secondaryLabel={saved ? undefined : 'Pomiń na razie'}
      onSecondary={() => {
        setAnswer('provider', 'none')
        void putSetting('provider', 'none')
        router.push(nextRoute('apikey') as never)
      }}
      scroll
    >
      <CredentialForm
        provider={provider}
        onSaved={(modelId) => {
          setAnswer('providerModel', modelId)
          setSaved(true)
        }}
      />
    </OnboardingScreen>
  )
}
