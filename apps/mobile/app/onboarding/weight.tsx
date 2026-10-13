import { router } from 'expo-router'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { EditableValue, RulerPicker } from '../../src/components/onboarding/Controls'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'
import { space } from '../../src/theme/tokens'

const DEFAULT_KG = 80

const MIN_KG = 30
const MAX_KG = 227

export default function WeightScreen() {
  const { width } = useWindowDimensions()
  const a = useAnswers()

  const kg = a.weightKg ?? DEFAULT_KG

  return (
    <OnboardingScreen
      step={stepIndex('weight')}
      total={TOTAL_STEPS}
      title="Ile ważysz?"
      subtitle="Uwzględnimy to przy obliczaniu Twoich dziennych celów żywieniowych."
      onCta={() => {
        if (a.weightKg == null) setAnswer('weightKg', DEFAULT_KG)
        router.push(nextRoute('weight') as never)
      }}
    >
      <View style={{ alignItems: 'center' }}>
        <View style={styles.readout}>
          <EditableValue
            label="Aktualna waga"
            value={kg}
            unit="kg"
            min={MIN_KG}
            max={MAX_KG}
            onCommit={(v) => setAnswer('weightKg', v)}
          />
        </View>
      </View>

      <View style={{ marginTop: space.lg, marginHorizontal: -space.lg }}>
        <RulerPicker
          width={width}
          min={MIN_KG}
          max={MAX_KG}
          step={0.1}
          value={Number(kg.toFixed(1))}
          onChange={(v) => setAnswer('weightKg', v)}
        />
      </View>
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  readout: { alignItems: 'center', marginTop: 96 },
})
