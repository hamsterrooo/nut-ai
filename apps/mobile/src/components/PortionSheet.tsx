import { useEffect, useMemo, useState } from 'react'
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
import type { ScoredCandidate } from '@nutai/resolver'
import { db as userDbHandle } from '../data/repo'
import { resolveSelection } from '../data/food-search-select'
import { loadPortionOptions, parsePositive, saveUserPortion, totalGrams, type PortionOption } from '../data/portion-options'
import { formatDecimal } from '../i18n/format'
import { useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../theme/tokens'

interface Props {
  candidate: ScoredCandidate
  nutritionDb: DbAdapter
  busy: boolean
  onCancel: () => void
  onConfirm: (grams: number) => void
}

/**
 * "How much?" for a food picked from the database: grams by default, plus helper
 * units (the product's own portions and units the user defined). The keyboard is
 * handled by the KeyboardAvoidingView around the card, so the field stays visible.
 */
export function PortionSheet({ candidate, nutritionDb, busy, onCancel, onConfirm }: Props) {
  const theme = useTheme()
  const [options, setOptions] = useState<PortionOption[]>([])
  const [selected, setSelected] = useState<PortionOption | null>(null)
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [snap, setSnap] = useState<{ kcal: number; protein_g: number; carbs_g: number; fat_g: number } | null>(null)
  const [adding, setAdding] = useState(false)
  const [unitName, setUnitName] = useState('')
  const [unitGrams, setUnitGrams] = useState('')
  const [unitError, setUnitError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      let userDb: DbAdapter | null = null
      try {
        userDb = await userDbHandle()
      } catch {
        userDb = null
      }
      const [defaults, opts] = await Promise.all([
        resolveSelection(nutritionDb, candidate),
        loadPortionOptions(nutritionDb, userDb, candidate),
      ])
      if (!alive) return
      setValue(String(Math.round(defaults.grams)))
      setSnap({
        kcal: candidate.energyKcal ?? defaults.nutrientSnapshot.kcal,
        protein_g: defaults.nutrientSnapshot.protein_g,
        carbs_g: defaults.nutrientSnapshot.carbs_g,
        fat_g: defaults.nutrientSnapshot.fat_g,
      })
      setOptions(opts)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [candidate, nutritionDb])

  const grams = useMemo(() => {
    const q = parsePositive(value)
    return q == null ? null : totalGrams(q, selected)
  }, [value, selected])

  function pick(opt: PortionOption | null) {
    setSelected(opt)
    setAdding(false)
    if (opt) setValue('1')
    else if (selected && grams != null) setValue(String(Math.round(grams)))
  }

  async function saveUnit() {
    const g = parsePositive(unitGrams)
    if (g == null) { setUnitError('Podaj masę jednej sztuki w gramach.'); return }
    try {
      const userDb = await userDbHandle()
      const saved = await saveUserPortion(userDb, candidate.name, unitName, g, Date.now())
      if (!saved) { setUnitError('Podaj nazwę (do 30 znaków) i masę do 5000 g.'); return }
      setOptions((prev) => [saved, ...prev.filter((o) => o.label.toLowerCase() !== saved.label.toLowerCase())])
      setUnitName('')
      setUnitGrams('')
      setUnitError(null)
      pick(saved)
    } catch {
      setUnitError('Nie udało się zapisać jednostki.')
    }
  }

  const chip = (active: boolean) => [
    styles.chip,
    { borderColor: active ? theme.text : theme.border, backgroundColor: active ? theme.text : 'transparent', minHeight: MIN_TAP_TARGET - 8 },
  ]
  const chipText = (active: boolean) => [type.label, { color: active ? theme.bg : theme.text }]

  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Zamknij" />
        <View style={[styles.card, { backgroundColor: theme.bgElevated }]}>
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            <Text style={[type.heading, { color: theme.text }]} numberOfLines={2}>{candidate.name}</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
              {candidate.energyKcal != null ? `${Math.round(candidate.energyKcal)} kcal / 100 g` : 'brak danych o energii'}
            </Text>

            {loading ? (
              <ActivityIndicator style={{ marginVertical: space.xl }} color={theme.textFaint} />
            ) : (
              <>
                <View style={styles.chips}>
                  <Pressable accessibilityRole="button" onPress={() => pick(null)} style={chip(selected == null && !adding)}>
                    <Text style={chipText(selected == null && !adding)}>g</Text>
                  </Pressable>
                  {options.map((o) => (
                    <Pressable key={o.id} accessibilityRole="button" onPress={() => pick(o)} style={chip(selected?.id === o.id)}>
                      <Text style={chipText(selected?.id === o.id)}>{`${o.label} · ${Math.round(o.grams)} g`}</Text>
                    </Pressable>
                  ))}
                  <Pressable accessibilityRole="button" onPress={() => { setAdding(true); setUnitError(null) }} style={chip(adding)}>
                    <Text style={chipText(adding)}>+ własna jednostka</Text>
                  </Pressable>
                </View>

                {adding ? (
                  <View style={{ marginTop: space.lg }}>
                    <TextInput
                      accessibilityLabel="Nazwa jednostki"
                      placeholder="Nazwa, np. ciastko"
                      placeholderTextColor={theme.textFaint}
                      value={unitName}
                      onChangeText={setUnitName}
                      maxLength={30}
                      style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                    />
                    <TextInput
                      accessibilityLabel="Masa jednej sztuki w gramach"
                      placeholder="Masa 1 sztuki w g"
                      placeholderTextColor={theme.textFaint}
                      keyboardType="numeric"
                      value={unitGrams}
                      onChangeText={setUnitGrams}
                      style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken, marginTop: space.sm }]}
                    />
                    {unitError ? <Text style={[type.caption, { color: theme.safety, marginTop: space.sm }]}>{unitError}</Text> : null}
                    <Pressable accessibilityRole="button" onPress={saveUnit} style={[styles.secondary, { borderColor: theme.border }]}>
                      <Text style={[type.bodyStrong, { color: theme.text }]}>Zapisz jednostkę</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ marginTop: space.lg }}>
                    <View style={styles.amountRow}>
                      <TextInput
                        accessibilityLabel={selected ? `Ilość: ${selected.label}` : 'Masa w gramach'}
                        keyboardType="numeric"
                        value={value}
                        onChangeText={setValue}
                        selectTextOnFocus
                        style={[styles.input, styles.amount, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                      />
                      <Text style={[type.body, { color: theme.textMuted, flexShrink: 1 }]} numberOfLines={1}>
                        {selected ? `× ${selected.label}` : 'g'}
                      </Text>
                    </View>
                    <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm }]}>
                      {grams != null
                        ? `= ${formatDecimal(grams, grams % 1 === 0 ? 0 : 1)} g`
                        : 'Wpisz dodatnią liczbę (do 10 000 g).'}
                    </Text>
                    {grams != null && snap ? (
                      <View style={[styles.strip, { backgroundColor: theme.bgSunken }]}>
                        {[
                          { k: 'kcal', v: (snap.kcal * grams) / 100, u: 'kcal' },
                          { k: 'W', v: (snap.carbs_g * grams) / 100, u: 'g' },
                          { k: 'B', v: (snap.protein_g * grams) / 100, u: 'g' },
                          { k: 'T', v: (snap.fat_g * grams) / 100, u: 'g' },
                        ].map((c) => (
                          <View key={c.k} style={styles.cell}>
                            <Text style={[type.bodyStrong, { color: theme.text }]}>{formatDecimal(c.v, 1)}</Text>
                            <Text style={[type.micro, { color: theme.textMuted }]}>{c.k === 'kcal' ? 'kcal' : `${c.k} (g)`}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                )}
              </>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={space.md} style={{ paddingVertical: space.md }}>
              <Text style={[type.body, { color: theme.textMuted }]}>Anuluj</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={grams == null || busy || adding}
              onPress={() => grams != null && onConfirm(grams)}
              style={[styles.confirm, { backgroundColor: theme.text, opacity: grams == null || busy || adding ? 0.4 : 1 }]}
            >
              {busy ? <ActivityIndicator color={theme.bg} /> : <Text style={[type.bodyStrong, { color: theme.bg }]}>Dodaj</Text>}
            </Pressable>
          </View>
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
    maxHeight: '85%',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  strip: { flexDirection: 'row', justifyContent: 'space-around', marginTop: space.md, paddingVertical: space.md, borderRadius: radius.md },
  cell: { alignItems: 'center', gap: 2 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, paddingHorizontal: space.md, justifyContent: 'center' },
  input: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, fontSize: 16, minHeight: 48 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  amount: { minWidth: 110, fontSize: 20, fontWeight: '600' },
  secondary: { marginTop: space.md, minHeight: 48, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg },
  confirm: { minHeight: 48, minWidth: 120, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
})
