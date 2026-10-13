import { router } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

export default function ThanksScreen() {
  const theme = useTheme()
  return (
    <OnboardingScreen
      step={stepIndex('thanks')}
      total={TOTAL_STEPS}
      title=""
      onCta={() => router.push(nextRoute('thanks') as never)}
    >
      <View style={{ alignItems: 'center' }}>
        <View style={[styles.halo, { borderColor: theme.uncertainBg }]}>
          <Icon name="check" size={72} color={theme.text} weight={1.4} />
        </View>

        <Text style={[styles.heading, { color: theme.text }]}>Dziękujemy za zaufanie!</Text>
        <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: space.md }]}>
          Teraz spersonalizujemy Nut AI dla Ciebie...
        </Text>

        <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.bodyStrong, { color: theme.text, textAlign: 'center' }]}>
            Dopasowane do Twoich celów
          </Text>
          <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.xs }]}>
            Twoje odpowiedzi ustalają Twoje cele, wpływają na dopasowywanie produktów i decydują,
            które części aplikacji są włączone.
          </Text>
        </View>
      </View>
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  halo: {
    width: 180, height: 180, borderRadius: radius.pill, borderWidth: 14,
    alignItems: 'center', justifyContent: 'center', marginTop: space.xl,
  },
  heading: {
    fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: -1,
    textAlign: 'center', marginTop: space.xl,
  },
  card: { marginTop: space.xl, padding: space.lg, borderRadius: radius.lg, width: '100%' },
})
