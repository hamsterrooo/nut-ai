import { router } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * Reminders.
 *
 * The system permission prompt is deliberately NOT requested here. Local
 * reminders are an M5 feature, and asking for a permission the app cannot yet
 * use is how apps train people to hit "Don't Allow" — you get one prompt, and
 * spending it before there is anything to deliver wastes it.
 *
 * Whether reminders default ON is already decided by the blocker answer
 * (featureDefaultsFor), so this screen is explanation, not another question.
 */
export default function NotificationsScreen() {
  const theme = useTheme()
  return (
    <OnboardingScreen
      step={stepIndex('notifications')}
      total={TOTAL_STEPS}
      title="Trzymaj kurs z Nut AI"
      onCta={() => router.push(nextRoute('notifications') as never)}
      scroll
    >
      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <Icon name="clock" size={44} color={theme.text} weight={1.5} />
        <Text style={[type.bodyStrong, { color: theme.text, marginTop: space.md }]}>
          Przypomnienie, gdy zwykle zapisujesz posiłki
        </Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm }]}>
          Przypomnienia uczą się, kiedy faktycznie zapisujesz posiłki, zamiast odpalać się o stałej
          godzinie, i każde jest lokalne na Twoim urządzeniu. Nic nie jest planowane na serwerze,
          bo serwera nie ma.
        </Text>
      </View>

      <Text style={[type.caption, { color: theme.textMuted, marginTop: space.lg }]}>
        O zgodę na powiadomienia zapytamy dopiero wtedy, gdy przypomnienie faktycznie będzie warte
        wysłania, a nie teraz. Włączysz je lub wyłączysz w każdej chwili w Ustawieniach.
      </Text>
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  card: { padding: space.xl, borderRadius: radius.xl, alignItems: 'center' },
})
