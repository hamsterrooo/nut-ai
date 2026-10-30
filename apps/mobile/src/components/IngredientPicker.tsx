import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { DbAdapter } from '@nutai/db-adapter'
import { resolveByText, type ScoredCandidate } from '@nutai/resolver'
import { resolveSelection } from '../data/food-search-select'
import type { ManualFoodSelection } from '../data/manual-food'
import { openNutritionDb } from '../db/expo-adapter'
import { formatDecimal } from '../i18n/format'
import { displayNameWithBrand } from '../scan/barcode-lookup'
import { useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../theme/tokens'

/**
 * Search the product database and hand back one product. Used by the meal editor
 * to swap an ingredient for a different product or to add a new one.
 */
export function IngredientPicker({
  title,
  onPick,
  onClose,
}: {
  title: string
  onPick: (selection: ManualFoodSelection) => void
  onClose: () => void
}) {
  const theme = useTheme()
  const [db, setDb] = useState<DbAdapter | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScoredCandidate[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void openNutritionDb().then((h) => {
      if (alive) setDb(h)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!db || query.trim().length < 2) {
      setResults([])
      setBusy(false)
      return
    }
    let alive = true
    const timer = setTimeout(async () => {
      setBusy(true)
      const r = await resolveByText(db, {
        canonicalFoodKey: query,
        observedBrand: null,
        prepFacet: null,
        modelCategory: null,
        estimatedGrams: 150,
      })
      if (!alive) return
      setResults(
        r.outcome.kind === 'auto_accept' ? [r.outcome.match] : r.outcome.kind === 'disambiguate' ? r.outcome.candidates : [],
      )
      setBusy(false)
    }, 180)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [db, query])

  async function pick(c: ScoredCandidate) {
    if (!db) return
    const sel = await resolveSelection(db, c)
    onPick({ ...sel, displayName: displayNameWithBrand(c.brand ?? null, c.name) })
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Zamknij" />
        <View style={[styles.card, { backgroundColor: theme.bgElevated }]}>
          <Text style={[type.heading, { color: theme.text }]}>{title}</Text>
          <TextInput
            autoFocus
            accessibilityLabel="Szukaj produktu"
            placeholder="Szukaj produktu"
            placeholderTextColor={theme.textFaint}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
          />
          {busy ? <ActivityIndicator style={{ marginTop: space.md }} color={theme.textFaint} /> : null}
          <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: space.sm }}>
            {results.map((r) => (
              <Pressable
                key={r.foodId}
                accessibilityRole="button"
                onPress={() => void pick(r)}
                style={({ pressed }) => [styles.row, { borderColor: theme.border, opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[type.body, { color: theme.text }]} numberOfLines={2}>
                  {displayNameWithBrand(r.brand ?? null, r.name)}
                </Text>
                <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                  {r.energyKcal != null ? `${formatDecimal(r.energyKcal, 0)} kcal / 100 g` : 'brak danych o energii'}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={space.md} style={{ alignSelf: 'center', paddingTop: space.md }}>
            <Text style={[type.body, { color: theme.textMuted }]}>Anuluj</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  card: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.lg,
    paddingBottom: space.xl,
    maxHeight: '80%',
  },
  input: {
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 48,
  },
  row: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: MIN_TAP_TARGET },
})
