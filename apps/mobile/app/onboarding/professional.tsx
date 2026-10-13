import { router } from 'expo-router'
import { ScrollView } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { OptionCard } from '../../src/components/onboarding/Controls'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'

export default function ProfessionalScreen() {
  const a = useAnswers()
  return (
    <OnboardingScreen
      step={stepIndex('professional')}
      total={TOTAL_STEPS}
      title="Czy współpracujesz obecnie z trenerem personalnym lub dietetykiem?"
      // The real consumer: someone with a professional gets the shareable PDF
      // export surfaced, and the app stops offering its own coaching nudges —
      // it should not argue with their dietitian.
      subtitle="Jeśli tak, pokażemy eksport do udostępnienia i nie będziemy wchodzić w drogę Twojemu coachingowi."
      ctaDisabled={a.worksWithProfessional == null}
      onCta={() => router.push(nextRoute('professional') as never)}
    >
      <ScrollView scrollEnabled={false}>
        <OptionCard
          label="Tak"
          glyph="thumbUp"
          selected={a.worksWithProfessional === true}
          onPress={() => setAnswer('worksWithProfessional', true)}
        />
        <OptionCard
          label="Nie"
          glyph="thumbDown"
          selected={a.worksWithProfessional === false}
          onPress={() => setAnswer('worksWithProfessional', false)}
        />
      </ScrollView>
    </OnboardingScreen>
  )
}
