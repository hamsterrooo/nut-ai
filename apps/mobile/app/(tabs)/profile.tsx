import { formatInteger } from '../../src/i18n/format'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Linking } from 'react-native'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ProviderId } from '@nutai/prompt'
import { availability, requestPermissions } from '../../src/health/healthkit'
import { exportAndShareBackup, finishRestore, importBackup, pickBackupFile } from '../../src/data/backup'
import { currentGoal, resetEverything, setting, type CurrentGoal } from '../../src/data/repo'
import { loadCredential, maskCredential } from '../../src/inference/credentials'
import { loadPublikWallet, publikConnected } from '../../src/inference/publik'
import { formatMicros } from '../../src/inference/publik-core'
import { PROVIDER_NAME } from '../../src/components/CredentialForm'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * Profile.
 *
 * Structurally the reference's settings list, minus everything that only exists
 * to extract money or attention:
 *
 *   NO "Refer a friend and earn $10" — a referral bounty is a growth mechanic,
 *   and there is no money here to pay it with.
 *   NO "Upgrade to Family Plan", no Premium crown. There is no paid tier.
 *   NO Logout / Delete Account. There is no account and no server; a delete
 *     button that only clears local data should say exactly that, which is what
 *     "Erase all data" below does.
 *   NO Follow Us. A settings screen is not a marketing surface.
 */
export default function Profile() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [healthAvail, setHealthAvail] = useState<'available' | 'not-ios' | 'unavailable' | 'checking'>('checking')
  const [healthBusy, setHealthBusy] = useState(false)
  const [diet, setDiet] = useState('')
  const [providerLabel, setProviderLabel] = useState('—')
  const [dataBusy, setDataBusy] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        const [g, avail, d, p] = await Promise.all([
          currentGoal(),
          availability(),
          setting('diet.style', 'balanced'),
          setting('provider'),
        ])
        if (!alive) return
        setGoal(g)
        setDiet(d)
        setHealthAvail(avail === 'available' ? 'available' : avail === 'not-ios' ? 'not-ios' : 'unavailable')
        if (!p || p === 'none') {
          setProviderLabel('Niepołączony')
        } else if (p === 'publik') {
          const [connected, wallet] = await Promise.all([publikConnected(), loadPublikWallet()])
          if (!alive) return
          // publik 0059: an unlinked phone sits at $0.00 until it is linked, so
          // that row says so instead of "$0.00 left".
          const unlinkedAtZero = wallet?.claimState === 'anonymous' && wallet.balanceMicros != null && wallet.balanceMicros <= 0
          setProviderLabel(
            !connected
              ? 'publik API · rozłączono'
              : unlinkedAtZero
                ? `publik API · ${formatMicros(0)} · niepołączone`
                : `publik API · ${formatMicros(wallet?.balanceMicros)} zostało`,
          )
        } else {
          const cred = await loadCredential(p as ProviderId)
          if (!alive) return
          setProviderLabel(
            cred
              ? `${PROVIDER_NAME[p as ProviderId]} · ${maskCredential(cred.value)}`
              : `${PROVIDER_NAME[p as ProviderId]} · brak klucza`,
          )
        }
      })()
      return () => {
        alive = false
      }
    }, []),
  )

  function connectHealth() {
    if (healthBusy) return
    setHealthBusy(true)
    void (async () => {
      const res = await requestPermissions()
      setHealthBusy(false)
      // iOS never reports whether READ access was granted — claiming success
      // here would be a lie. Say what actually happened and point at Settings.
      if (res.prompted) {
        Alert.alert('Gotowe', 'Jeśli zezwolono na dostęp, kroki i treningi pojawią się po synchronizacji.')
      } else {
        Alert.alert(
          'Zdrowie nie odpowiedziało',
          'Zarządzaj dostępem w Ustawieniach → Prywatność i ochrona → Zdrowie albo przyciskiem poniżej.',
        )
      }
    })()
  }

  function exportData() {
    if (dataBusy) return
    setDataBusy(true)
    void (async () => {
      try {
        const res = await exportAndShareBackup()
        if (!res.shared) Alert.alert('Wyeksportowano', `Zapisano jako ${res.name}. Udostępnianie jest niedostępne na tym urządzeniu.`)
      } catch {
        Alert.alert('Eksport nie powiódł się', 'Nie udało się zapisać pliku kopii. Spróbuj ponownie.')
      } finally {
        setDataBusy(false)
      }
    })()
  }

  function importData() {
    if (dataBusy) return
    void (async () => {
      const picked = await pickBackupFile()
      if (!picked.ok) {
        if (picked.reason !== 'cancelled') {
          Alert.alert('To nie jest kopia', 'To nie wygląda na plik kopii zapasowej Nut AI.')
        }
        return
      }
      Alert.alert(
        'Przywrócić tę kopię?',
        'To zastąpi WSZYSTKIE dane obecnie na tym urządzeniu i nie można tego cofnąć.',
        [
          { text: 'Anuluj', style: 'cancel' },
          {
            text: 'Przywróć',
            style: 'destructive',
            onPress: () => {
              setDataBusy(true)
              void (async () => {
                try {
                  const outcome = await importBackup(picked.payload)
                  if (!outcome.ok) {
                    Alert.alert('Nie można przywrócić', 'Ta kopia pochodzi z nowszej wersji Nut AI. Najpierw zaktualizuj aplikację.')
                    return
                  }
                  await finishRestore()
                  router.replace('/(tabs)' as never)
                } catch (e) {
                  // A restore that fails must SAY SO — the transaction rolled
                  // back, nothing was lost, and silence here cost us a real
                  // debugging session once already.
                  Alert.alert('Przywracanie nie powiodło się', `Nic nie zostało zmienione. ${String((e as Error)?.message ?? e)}`)
                } finally {
                  setDataBusy(false)
                }
              })()
            },
          },
        ],
      )
    })()
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 150 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[type.title, { color: theme.text }]}>Profil</Text>

      <View style={[styles.hero, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>No account needed</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
          Wszystko jest na tym urządzeniu. Nie ma logowania ani serwera, więc nie ma czego wykradać.
        </Text>
      </View>

      <Section title="Cele i śledzenie">
        <Row
          label="Dzienny cel"
          value={goal ? `${Math.round(goal.targetKcal)} kcal` : '—'}
          onPress={() => router.push('/edit-goals' as never)}
        />
        <Row
          label="Białko / Węglowodany / Tłuszcz"
          value={goal ? `${Math.round(goal.protein_g)} / ${Math.round(goal.carbs_g)} / ${Math.round(goal.fat_g)} g` : '—'}
          onPress={() => router.push('/edit-goals' as never)}
        />
        <Row label="Zapisz wagę" value="" onPress={() => router.push('/log-weight' as never)} />
        <Row label="Styl diety" value={diet} />
        <Row
          label="Cel adaptacyjny"
          value={goal ? (goal.adaptive ? 'Włączony' : 'Wyłączony, ustawiony ręcznie') : '—'}
        />
      </Section>

      <Section title="Dostawca AI">
        <Row label="Dostawca i klucz" value={providerLabel} onPress={() => router.push('/provider-settings' as never)} />
      </Section>

      <Section title="Apple Zdrowie">
        {healthAvail === 'available' ? (
          <>
            <Row
              label={healthBusy ? 'Łączenie…' : 'Połącz / połącz ponownie'}
              value=""
              onPress={connectHealth}
            />
            <Pressable onPress={() => void Linking.openSettings()} style={{ padding: space.lg, paddingTop: 0 }}>
              <Text style={[type.caption, { color: theme.textMuted }]}>
                Już odpowiedziano na prośbę o dostęp? <Text style={{ color: theme.protein }}>Zarządzaj dostępem w Ustawieniach</Text>
              </Text>
            </Pressable>
          </>
        ) : (
          <Row label="Apple Zdrowie" value={healthAvail === 'not-ios' ? 'Tylko iOS' : 'Niedostępne na tym urządzeniu'} />
        )}
      </Section>

      <Section title="Twoje dane">
        <Row label={dataBusy ? 'Praca w toku…' : 'Eksportuj dane'} value="" onPress={exportData} />
        <Row label="Importuj dane" value="" onPress={importData} />
        <Text style={[type.caption, { color: theme.textFaint, padding: space.lg, paddingTop: space.xs, lineHeight: 18 }]}>
          Jeden plik JSON ze wszystkim: posiłkami, wagami, celami i ustawieniami. Twój klucz API
          nigdy w nim nie trafia, więc po przywróceniu na nowym telefonie wpiszesz go jeszcze raz.
        </Text>
      </Section>

      <Section title="Jak działają Twoje liczby">
        {goal ? (
          <View style={{ padding: space.lg, gap: space.sm }}>
            <Line label="BMR (Mifflin-St Jeor)" value={`${formatInteger(goal.bmr)} kcal`} />
            <Line label="TDEE (BMR × aktywność)" value={`${formatInteger(goal.tdee)} kcal`} />
            <Line label="Twój cel" value={`${formatInteger(goal.targetKcal)} kcal`} />
            {goal.floorApplied ? (
              <Text style={[type.caption, { color: theme.uncertain, marginTop: space.xs }]}>
                Podniesiono do naszej bezpiecznej granicy. Same Twoje dane dały {formatInteger(goal.targetRawKcal)} kcal.
              </Text>
            ) : null}
          </View>
        ) : null}
      </Section>

      <Section title="Zacznij od nowa">
        <Row
          label="Powtórz konfigurację"
          value=""
          onPress={() => {
            Alert.alert(
              'Usunąć wszystko i zacząć od nowa?',
              'Usuwa z tego urządzenia Twój profil, cele, historię wagi, zapisane posiłki i zapisane klucze API oraz rozłącza publik API. Nie można tego cofnąć, a kopii na serwerze nie ma, bo nie mamy własnego serwera.',
              [
                { text: 'Anuluj', style: 'cancel' },
                {
                  text: 'Usuń i zacznij od nowa',
                  style: 'destructive',
                  onPress: () => {
                    void resetEverything().then(() => router.replace('/onboarding' as never))
                  },
                },
              ],
            )
          }}
        />
      </Section>

      <Section title="O aplikacji">
        <Row label="Licencja" value="AGPL-3.0" />
        <Row label="Dane żywieniowe" value="USDA, CC0" />
      </Section>

      <Text style={[type.caption, { color: theme.textFaint, marginTop: space.xl, lineHeight: 19 }]}>
        Szacunki Nut AI to przybliżenia wygenerowane przez AI i mogą być niedokładne. Aplikacja
        nie jest wyrobem medycznym i niczego nie diagnozuje, nie leczy ani nie zapobiega żadnej
        chorobie. Przed podjęciem decyzji medycznych skonsultuj się z dietetykiem lub lekarzem.
      </Text>
    </ScrollView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ marginTop: space.xl }}>
      <Text style={[type.label, { color: theme.textMuted, marginBottom: space.sm }]}>{title}</Text>
      <View style={[styles.group, { backgroundColor: theme.bgSunken }]}>{children}</View>
    </View>
  )
}

function Row({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const theme = useTheme()
  const body = (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Text style={[type.body, { color: theme.text, flex: 1 }]}>{label}</Text>
      {value ? <Text style={[type.body, { color: theme.textMuted }]}>{value}</Text> : null}
      {onPress ? (
        <View style={{ marginLeft: space.sm }}>
          <Icon name="chevron" size={16} color={theme.textFaint} />
        </View>
      ) : null}
    </View>
  )
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    body
  )
}

function Line({ label, value }: { label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={[type.caption, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[type.caption, { color: theme.text, fontWeight: '600' }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { marginTop: space.lg, padding: space.lg, borderRadius: radius.xl },
  group: { borderRadius: radius.xl, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
})
