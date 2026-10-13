import { router } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

export default function GenerateScreen() {
  const theme = useTheme()
  return (
    <OnboardingScreen
      step={stepIndex('generate')}
      total={TOTAL_STEPS}
      title=""
      onCta={() => router.push('/onboarding/plan' as never)}
    >
      <View style={{ alignItems: 'center' }}>
        <View style={[styles.halo, { borderColor: theme.uncertainBg }]}>
          <Icon name="heart" size={72} color={theme.text} weight={1.4} />
        </View>

        <View style={styles.doneRow}>
          <Icon name="check" size={18} color={theme.affirm} weight={2.4} />
          <Text style={[type.bodyStrong, { color: theme.text }]}>Gotowe!</Text>
        </View>

        <Text style={[styles.heading, { color: theme.text }]}>
          Czas wygenerować Twój spersonalizowany plan!
        </Text>
      </View>
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  halo: {
    width: 200, height: 200, borderRadius: radius.pill, borderWidth: 16,
    alignItems: 'center', justifyContent: 'center', marginTop: space.xxl,
  },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xl },
  heading: {
    fontSize: 34, lineHeight: 42, fontWeight: '800', letterSpacing: -1,
    textAlign: 'center', marginTop: space.md,
  },
})
