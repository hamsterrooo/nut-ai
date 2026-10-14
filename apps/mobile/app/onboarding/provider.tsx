import { router } from 'expo-router'
import { formatDecimal } from '../../src/i18n/format'
import { useEffect } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { cheapestModel, PROVIDER_MODELS, providersByPrice, type ProviderId } from '@nutai/prompt'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { OptionCard } from '../../src/components/onboarding/Controls'
import type { IconName } from '../../src/components/Icon'
import { putSetting } from '../../src/data/repo'
import { publikAvailable } from '../../src/inference/publik'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * How should Nut AI recognize your food?
 *
 * publik API sits FIRST and PRESELECTED: it is not one of the vendors the user
 * chooses among, it is the app's own default supply, disclosed as such on the
 * next screen (cost, and where the photo goes) before anything is minted.
 *
 * THE VENDOR PICKER BELOW IT IS NEUTRAL. Price-sorted, no "recommended" badge,
 * no pre-selected vendor. Within a chosen provider the cheapest vision model is
 * pre-selected, which is honest rather than a compromise: the literature says
 * frontier models are NOT better at portion estimation, and portion is the
 * dominant error source. Paying 5-30x buys identification quality we already
 * have.
 *
 * Neutrality among the vendors is also the cheapest available mitigation
 * against being treated as a joint controller of the data the user sends to a
 * provider we recommended.
 */

const LABELS: Record<ProviderId, { name: string; icon: IconName; note: string }> = {
  openai: { name: 'OpenAI', icon: 'scan', note: 'GPT-4o i 4o-mini' },
  google: { name: 'Google', icon: 'scan', note: 'Gemini, tylko płatny poziom' },
  anthropic: { name: 'Anthropic', icon: 'scan', note: 'Claude Haiku i Sonnet' },
}

export default function ProviderScreen() {
  const theme = useTheme()
  const a = useAnswers()
  const order = providersByPrice()
  const publik = publikAvailable()

  // Preselection is an onboarding behaviour only: a fresh run with no answer
  // yet lands on publik; an existing install with a vendor key is never
  // switched (the resolver reads the settings table, not this store).
  useEffect(() => {
    if (publik && a.provider === undefined) setAnswer('provider', 'publik')
  }, [publik, a.provider])

  return (
    <OnboardingScreen
      step={stepIndex('provider')}
      total={TOTAL_STEPS}
      title="Jak Nut AI ma rozpoznawać Twoje jedzenie?"
      subtitle={
        publik
          ? 'Skany domyślnie działają na publik API: połącz konto publik, aby jednorazowo dostać 0,05 $ darmowego użycia. Wolisz własny klucz? Wybierz dostawcę. Twoje zdjęcie trafia tylko do wskazanego dostawcy, nie prowadzimy własnego serwera.'
          : 'Użyj własnego klucza API. Twoje zdjęcie trafia do wskazanego dostawcy i nigdzie indziej, nie prowadzimy serwera.'
      }
      ctaDisabled={a.provider === undefined}
      onCta={() => {
        if (a.provider === 'none') void putSetting('provider', 'none')
        router.push((a.provider === 'none' ? nextRoute('apikey') : nextRoute('provider')) as never)
      }}
      scroll
    >
      <ScrollView scrollEnabled={false}>
        {publik ? (
          <OptionCard
            label="publik API"
            sublabel="Bez wklejania klucza. Zaczynasz od 0,00 $; po połączeniu konta publik dostajesz jednorazowo 0,05 $ darmowego użycia. Cena za skan to 50% ceny katalogowej modelu."
            glyph="scan"
            selected={a.provider === 'publik'}
            onPress={() => setAnswer('provider', 'publik')}
          />
        ) : null}

        {order.map((p) => {
          const cheap = cheapestModel(p)
          return (
            <OptionCard
              key={p}
              label={LABELS[p].name}
              sublabel={`${LABELS[p].note} · ~${formatDecimal(cheap.approxScanCostUsd, 4)} $ za skan`}
              glyph={LABELS[p].icon}
              selected={a.provider === p}
              onPress={() => setAnswer('provider', p)}
            />
          )
        })}

        <OptionCard
          label="Na razie bez klucza"
          sublabel="Kod kreskowy, skan etykiety, wyszukiwanie tekstowe i ręczne dodawanie nadal działają"
          glyph="minus"
          selected={a.provider === 'none'}
          onPress={() => setAnswer('provider', 'none')}
        />
      </ScrollView>

      <View style={[styles.note, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
          {publik ? 'Trzech dostawców poniżej posortowano' : 'Posortowano'} według ceny, bez rekomendacji. Najlepsze modele nie są wyraźnie lepsze w ocenie
          wielkości porcji, a w niej siedzi prawie cały błąd, więc najtańszy model wizyjny jest
          wybrany celowo, a nie z konieczności.
        </Text>
      </View>

      {a.provider === 'google' ? (
        <View style={[styles.warn, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text, lineHeight: 19 }]}>
            Darmowy poziom Gemini jest zablokowany dla skanów zdjęć. Warunki API Google mówią: "nie
            przesyłaj informacji wrażliwych, poufnych ani osobowych do usług bezpłatnych", a zdjęcie
            posiłku to dane o zdrowiu. Płatny klucz Google działa normalnie.
          </Text>
        </View>
      ) : null}

      {a.provider && a.provider !== 'none' && a.provider !== 'publik' ? (
        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.lg, lineHeight: 19 }]}>
          Dostępne modele: {PROVIDER_MODELS[a.provider].length}. Model zmienisz i ustawisz
          miesięczny limit wydatków po wpisaniu klucza.
        </Text>
      ) : null}
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  note: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  warn: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
})
