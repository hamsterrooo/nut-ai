import { router } from 'expo-router'
import { TransitionChart } from '../../src/components/onboarding/Charts'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { inferredGoal, useAnswers } from '../../src/onboarding/store'

export default function PotentialScreen() {
  const a = useAnswers()
  return (
    <OnboardingScreen
      step={stepIndex('potential')}
      total={TOTAL_STEPS}
      title="Masz ogromny potencjał, by zrealizować swój cel"
      onCta={() => router.push(nextRoute('potential') as never)}
      scroll
    >
      {/* The curve follows the user's actual goal direction rather than always
          sloping the same way, so a gaining user is not shown a losing chart. */}
      <TransitionChart gaining={inferredGoal(a) === 'gain'} />
    </OnboardingScreen>
  )
}
