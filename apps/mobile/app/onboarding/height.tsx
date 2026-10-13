import { router } from 'expo-router'
import { useMemo } from 'react'
import { View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { Wheel, WheelHighlight } from '../../src/components/onboarding/Controls'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'
import { space } from '../../src/theme/tokens'

const DEFAULT_CM = 170

export default function HeightScreen() {
  const a = useAnswers()
  const cm = a.heightCm ?? DEFAULT_CM

  const cms = useMemo(
    () => Array.from({ length: 151 }, (_, i) => ({ value: i + 100, label: `${i + 100} cm` })),
    [],
  )

  return (
    <OnboardingScreen
      step={stepIndex('height')}
      total={TOTAL_STEPS}
      title="Jaki jest Twój wzrost?"
      subtitle="Uwzględnimy to przy obliczaniu Twoich dziennych celów żywieniowych."
      onCta={() => {
        if (a.heightCm == null) setAnswer('heightCm', DEFAULT_CM)
        router.push(nextRoute('height') as never)
      }}
    >
      <View style={{ marginTop: 88 }}>
        <WheelHighlight>
          <Wheel
            label="Centymetry"
            items={cms}
            value={Math.round(cm)}
            width={space.xxxl * 4}
            onChange={(v) => setAnswer('heightCm', v)}
          />
        </WheelHighlight>
      </View>
    </OnboardingScreen>
  )
}
