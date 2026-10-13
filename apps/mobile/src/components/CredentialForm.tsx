import { formatDecimal } from '../i18n/format'
import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { cheapestModel, type ProviderId } from '@nutai/prompt'
import { putSetting } from '../data/repo'
import { looksPlausible, saveCredential, type CredentialKind } from '../inference/credentials'
import { validateCredential } from '../inference/pathA/validate'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, type } from '../theme/tokens'
import { Icon } from './Icon'

/**
 * The credential entry + validation form, shared VERBATIM between onboarding
 * and settings. The validation UX here — two Anthropic credential shapes, six
 * named failure states, wrong-tab recovery, raw HTTP detail on failure — is
 * exactly the kind of logic that silently drifts when copy-pasted, and a
 * drifted copy is how "works in onboarding, broken in settings" happens.
 *
 * On success it persists everything scans need (Keychain credential + the
 * provider/provider_model settings the orchestrator reads) and reports up.
 */

const CONSOLE_URL: Record<ProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/apikey',
}

export const PROVIDER_NAME: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}

export function CredentialForm({
  provider,
  onSaved,
}: {
  provider: ProviderId
  onSaved: (modelId: string) => void
}) {
  const theme = useTheme()
  const [kind, setKind] = useState<CredentialKind>('api_key')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The raw status and body. Shown on failure so a bad key is diagnosable
  // instead of mysterious — a generic message is what made this unfixable.
  const [detail, setDetail] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [shape, setShape] = useState<string | null>(null)

  const model = cheapestModel(provider)
  const plausible = looksPlausible(provider, kind, value)

  async function verify() {
    if (busy || !plausible) return
    setBusy(true)
    setError(null)

    const res = await validateCredential(provider, model.id, { kind, value: value.trim() })
    setBusy(false)

    if (!res.ok) {
      setError(explain(res.error.kind, res.error.message))
      setDetail(res.detail)
      return
    }

    // Store the shape the provider ACTUALLY accepted, not the tab that was
    // selected — pasting a CLI token into the API-key tab is the most common
    // mistake here, and correcting it silently beats failing on it.
    const acceptedKind = res.usedShape === 'bearer' ? 'oauth' : 'api_key'
    await saveCredential(provider, { kind: acceptedKind, value: value.trim() })
    await putSetting('provider', provider)
    await putSetting('provider_model', model.id)
    setShape(res.usedShape)
    setOk(true)
    onSaved(model.id)
  }

  return (
    <View>
      {/* Anthropic accepts either shape, so the choice is explicit. */}
      {provider === 'anthropic' ? (
        <View style={[styles.tabs, { backgroundColor: theme.bgSunken }]}>
          {(['api_key', 'oauth'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => {
                setKind(k)
                setError(null)
              }}
              style={[styles.tab, kind === k && { backgroundColor: theme.bgElevated }]}
            >
              <Text style={[type.label, { color: kind === k ? theme.text : theme.textMuted }]}>
                {k === 'api_key' ? 'Klucz API' : 'Token Claude CLI'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[styles.how, { backgroundColor: theme.bgSunken }]}>
        {provider === 'anthropic' && kind === 'oauth' ? (
          <>
            <Text style={[type.bodyStrong, { color: theme.text }]}>Zaloguj się przez Claude CLI</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
              Na komputerze z zainstalowanym Claude Code uruchom to polecenie i wklej to, co wypisze:
            </Text>
            <Pressable
              onPress={() => void Clipboard.setStringAsync('claude setup-token')}
              style={[styles.code, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
            >
              <Text style={[styles.mono, { color: theme.text }]}>claude setup-token</Text>
              <Icon name="bookmark" size={16} color={theme.textFaint} />
            </Pressable>
            <Text style={[type.caption, { color: theme.textFaint, marginTop: space.sm, lineHeight: 18 }]}>
              To korzysta z Twojej istniejącej subskrypcji Claude zamiast kredytu API. Sprawdzenie
              poniżej potwierdza, że token naprawdę potrafi wykonywać skany, a nie tylko się logować.
            </Text>
          </>
        ) : (
          <>
            <Text style={[type.bodyStrong, { color: theme.text }]}>
              Weź klucz od {PROVIDER_NAME[provider]}
            </Text>
            <Pressable
              onPress={() => void Linking.openURL(CONSOLE_URL[provider])}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm }}
            >
              <Text style={[type.label, { color: theme.protein }]}>Otwórz konsolę</Text>
              <Icon name="chevron" size={14} color={theme.protein} />
            </Pressable>
            <Text style={[type.caption, { color: theme.textFaint, marginTop: space.sm, lineHeight: 18 }]}>
              Rozliczenia to sprawa między Tobą a {PROVIDER_NAME[provider]}. Nigdy nie widzimy klucza,
              a tutaj nie ma konta, do którego można by go przypiąć.
            </Text>
          </>
        )}
      </View>

      <TextInput
        accessibilityLabel="Poświadczenie API"
        placeholder={kind === 'oauth' ? 'Wklej token' : 'sk-…'}
        placeholderTextColor={theme.textFaint}
        value={value}
        onChangeText={(t) => {
          setValue(t)
          setError(null)
          setDetail(null)
          setOk(false)
        }}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!ok}
        editable={!busy}
        style={[styles.input, { color: theme.text, backgroundColor: theme.bgSunken, borderColor: error ? theme.safety : theme.border }]}
      />

      {busy ? (
        <View style={{ marginTop: space.lg, alignItems: 'center' }}>
          <ActivityIndicator color={theme.textFaint} />
        </View>
      ) : null}

      {error ? (
        <View style={[styles.result, { backgroundColor: theme.safetyBg }]}>
          <Text style={[type.caption, { color: theme.safety, lineHeight: 19 }]}>{error}</Text>
          {detail ? (
            <Text style={[styles.mono, { color: theme.safety, marginTop: space.sm, fontSize: 11 }]}>
              {detail}
            </Text>
          ) : null}
        </View>
      ) : null}

      {ok ? (
        <View style={[styles.result, { backgroundColor: theme.uncertainBg }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="check" size={18} color={theme.affirm} weight={2.4} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>Klucz działa</Text>
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
            Zweryfikowano jako {shape === 'bearer' ? 'token OAuth / CLI' : 'klucz API'}. Używany model:{' '}
            {model.label}, ok. {formatDecimal(model.approxScanCostUsd, 4)} $ za skan.
          </Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={busy || !plausible}
          onPress={verify}
          style={[
            styles.verify,
            { backgroundColor: theme.text },
            (busy || !plausible) && { opacity: 0.4 },
          ]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>
            {busy ? 'Sprawdzanie…' : 'Sprawdź i zapisz'}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

/** Six named states. "Something went wrong" tells nobody what to do next. */
function explain(kind: string, fallback: string): string {
  switch (kind) {
    case 'key-invalid':
      return 'To poświadczenie zostało odrzucone. Sprawdź, czy skopiowano całość i czy zakładka powyżej pasuje do jego typu: klucz API i token CLI używają innych nagłówków.'
    case 'quota-exhausted':
      return 'Poświadczenie działa, ale na koncie skończył się kredyt. Dodaj płatności u dostawcy i spróbuj ponownie.'
    case 'model-unavailable':
      return 'Poświadczenie działa, ale ten model nie jest włączony dla tego konta. Niektóre modele wymagają historii płatności, zanim się odblokują.'
    case 'offline':
      return 'Brak połączenia z dostawcą. Nic nie zostało zapisane, spróbuj ponownie, gdy wrócisz do sieci.'
    case 'timeout-ambiguous':
      return 'Sprawdzanie przekroczyło limit czasu. Nic nie zostało zapisane.'
    default:
      return fallback
  }
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderRadius: radius.pill, padding: 4, marginBottom: space.lg },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.pill },
  how: { padding: space.lg, borderRadius: radius.lg },
  code: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Menlo is iOS-only; Android silently falls back to the default sans unless
  // told 'monospace' explicitly.
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 15 },
  input: {
    marginTop: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 54,
  },
  result: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  verify: {
    marginTop: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
})
