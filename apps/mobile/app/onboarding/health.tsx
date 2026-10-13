import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { availability, requestPermissions, type HealthAvailability } from '../../src/health/healthkit'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer } from '../../src/onboarding/store'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * Apple Health.
 *
 * Continue presents the real HealthKit sheet.
 *
 * WHAT THIS SCREEN WILL NOT CLAIM: that permission was granted. iOS never reports
 * whether a READ permission was allowed — `requestAuthorization` resolves
 * identically whether you tapped Allow or Don't Allow, because Apple treats "this
 * app knows you declined" as itself a privacy leak. So the copy afterwards says
 * the sheet was shown, not that syncing works. Write access IS reported, and that
 * is the one thing stated as fact.
 *
 * On the Simulator HealthKit exists but has no data, so an empty read there means
 * nothing — which is exactly why this screen never reports success from silence.
 */
export default function HealthScreen() {
  const theme = useTheme()
  const [avail, setAvail] = useState<HealthAvailability | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void availability().then((a) => {
      if (alive) setAvail(a)
    })
    return () => {
      alive = false
    }
  }, [])

  const go = () => router.push(nextRoute('health') as never)

  async function connect() {
    if (busy) return

    if (avail !== 'available') {
      setAnswer('healthConnected', false)
      go()
      return
    }

    setBusy(true)
    const res = await requestPermissions()
    setBusy(false)

    setAnswer('healthConnected', res.prompted)

    if (res.error) {
      setOutcome(res.error)
      return
    }
    // Deliberately not "Connected!". See the note above about read status.
    setOutcome(
      res.canWrite
        ? 'Zdrowie jest skonfigurowane. Zapisane posiłki trafią do aplikacji Zdrowie.'
        : 'Okno Zdrowie zostało zamknięte. Możemy korzystać z tego, na co tam zezwolisz. iOS nie informuje aplikacji, które odczyty zostały przyznane.',
    )
  }

  const unsupported = avail === 'not-ios' || avail === 'unavailable'

  return (
    <OnboardingScreen
      step={stepIndex('health')}
      total={TOTAL_STEPS}
      title=""
      cta={outcome || unsupported ? 'Dalej' : 'Połącz z Apple Zdrowie'}
      onCta={outcome || unsupported ? go : connect}
      ctaDisabled={busy}
      {...(outcome ? {} : { secondaryLabel: 'Pomiń' })}
      onSecondary={() => {
        setAnswer('healthConnected', false)
        go()
      }}
      scroll
    >
      <View style={{ alignItems: 'center' }}>
        <View style={[styles.halo, { backgroundColor: theme.uncertainBg }]}>
          <View style={styles.row}>
            <View style={[styles.tile, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
              <Icon name="heart" size={34} color="#E8615A" />
            </View>
            <Icon name="chevron" size={20} color={theme.textMuted} />
            <View style={[styles.tile, { backgroundColor: theme.text }]}>
              <Icon name="flame" size={34} color={theme.bg} />
            </View>
          </View>
          <View style={styles.wordRow}>
            {['Kroki', 'Treningi', 'Waga', 'Energia'].map((w) => (
              <View key={w} style={[styles.word, { backgroundColor: theme.bgElevated }]}>
                <Text style={[type.label, { color: theme.text }]}>{w}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <Text style={[styles.heading, { color: theme.text }]}>Połącz z Apple Zdrowie</Text>
      <Text style={[type.body, { color: theme.textMuted, marginTop: space.md }]}>
        Synchronizuj codzienną aktywność między Nut AI a aplikacją Zdrowie, żeby Twój cel
        kaloryczny uwzględniał to, co faktycznie robisz.
      </Text>

      {busy ? (
        <View style={{ marginTop: space.xl, alignItems: 'center' }}>
          <ActivityIndicator color={theme.textFaint} />
        </View>
      ) : null}

      {outcome ? (
        <View style={[styles.note, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text }]}>{outcome}</Text>
        </View>
      ) : null}

      {unsupported && avail != null ? (
        <View style={[styles.note, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text }]}>
            {avail === 'not-ios'
              ? 'Apple Zdrowie działa tylko na iOS. Na Androidzie zostanie użyte Health Connect.'
              : 'Dane zdrowotne nie są dostępne na tym urządzeniu, więc nie ma z czym się łączyć.'}
          </Text>
        </View>
      ) : null}

      <Text style={[type.caption, { color: theme.textFaint, marginTop: space.lg, lineHeight: 19 }]}>
        Prosimy o odczyt kroków, treningów, wagi i aktywnej energii oraz o zapis posiłków, które
        dodajesz. Nic więcej. Wszystko zmienisz później w aplikacji Zdrowie, w sekcji Źródła.
      </Text>
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  halo: {
    width: '100%', borderRadius: radius.xl, paddingVertical: space.xxl,
    alignItems: 'center', marginTop: space.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  tile: {
    width: 86, height: 86, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth,
  },
  wordRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm, marginTop: space.lg },
  word: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill },
  heading: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1, marginTop: space.xl },
  note: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
})
