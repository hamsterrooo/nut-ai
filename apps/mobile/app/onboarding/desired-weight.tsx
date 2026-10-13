import { router } from 'expo-router'
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { bmi, UNDERWEIGHT_BMI } from '@nutai/goals'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { EditableValue, RulerPicker } from '../../src/components/onboarding/Controls'
import { formatDecimal } from '../../src/i18n/format'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { inferredGoal, MAINTAIN_THRESHOLD_KG, setAnswer, useAnswers } from '../../src/onboarding/store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

const GOAL_LABEL = { lose: 'Redukcja wagi', maintain: 'Utrzymanie wagi', gain: 'Przyrost wagi' } as const

const MIN_KG = 30
const MAX_KG = 227

export default function DesiredWeightScreen() {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const a = useAnswers()

  const currentKg = a.weightKg ?? 80
  // Defaults to the CURRENT weight, i.e. "maintain", so the direction is
  // something the user chooses by moving, not something we assumed for them.
  const kg = a.desiredWeightKg ?? currentKg

  // The non-blocking underweight note. It appears HERE, at goal-weight entry,
  // rather than after the plan is generated — telling someone their target is
  // concerning only once it is already on screen is far worse than saying it
  // while they are choosing. It never blocks Continue.
  const goalBmi = a.heightCm ? bmi(kg, a.heightCm) : null
  const underweight = goalBmi != null && goalBmi < UNDERWEIGHT_BMI

  // Direction is DERIVED, and updates live as the ruler moves — pass the current
  // ruler value rather than the stored one so the label never lags a frame.
  const goal = inferredGoal({ weightKg: currentKg, desiredWeightKg: kg })
  const deltaKg = Math.abs(kg - currentKg)

  return (
    <OnboardingScreen
      step={stepIndex('desired-weight')}
      total={TOTAL_STEPS}
      title="Jaka jest Twoja docelowa waga?"
      onCta={() => {
        if (a.desiredWeightKg == null) setAnswer('desiredWeightKg', kg)
        router.push(nextRoute('desired-weight') as never)
      }}
    >
      <View style={{ alignItems: 'center', marginTop: 72 }}>
        <EditableValue
          label={GOAL_LABEL[goal]}
          value={kg}
          unit="kg"
          min={MIN_KG}
          max={MAX_KG}
          onCommit={(v) => setAnswer('desiredWeightKg', v)}
        />
      </View>

      <View style={{ marginTop: space.lg, marginHorizontal: -space.lg }}>
        <RulerPicker
          width={width}
          min={MIN_KG}
          max={MAX_KG}
          step={0.1}
          value={Number(kg.toFixed(1))}
          onChange={(v) => setAnswer('desiredWeightKg', v)}
        />
      </View>

      <View style={{ alignItems: 'center', marginTop: space.lg }}>
        <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center' }]}>
          {goal === 'maintain'
            ? `Do ${MAINTAIN_THRESHOLD_KG} kg od obecnej wagi, więc ustawimy plan utrzymania wagi.`
            : `${formatDecimal(deltaKg)} kg do ${goal === 'gain' ? 'przytycia' : 'zrzucenia'}. Kierunek wyliczamy z tych dwóch liczb.`}
        </Text>
      </View>

      {underweight ? (
        <View style={[styles.note, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text }]}>
            Ten cel oznacza BMI poniżej 18,5. Nadal możesz go wybrać, to tylko informacja.
            Nigdy nie ustawimy celu kalorycznego poniżej bezpiecznego minimum.
          </Text>
        </View>
      ) : null}
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  note: { marginTop: space.xl, padding: space.lg, borderRadius: radius.lg },
})
