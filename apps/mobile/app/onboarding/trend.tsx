import { router } from 'expo-router'
import { TrendComparisonChart } from '../../src/components/onboarding/Charts'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { inferredGoal, useAnswers } from '../../src/onboarding/store'

export default function TrendScreen() {
  const a = useAnswers()
  return (
    <OnboardingScreen
      step={stepIndex('trend')}
      total={TOTAL_STEPS}
      title="Stworzone, by pomóc Ci trzymać kurs"
      onCta={() => router.push(nextRoute('trend') as never)}
      scroll
    >
      <TrendComparisonChart gaining={inferredGoal(a) === 'gain'} />
    </OnboardingScreen>
  )
}
