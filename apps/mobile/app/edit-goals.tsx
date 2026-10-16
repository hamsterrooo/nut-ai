import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ActivityLevel } from '@nutai/goals'
import { reconcileFromMacros } from '@nutai/totals'
import { formatDecimal, formatInteger } from '../src/i18n/format'
import {
  applyRecomputedGoal,
  currentGoal,
  overrideTargets,
  recomputeGoalFromProfile,
  type CurrentGoal,
  type RecomputedGoal,
} from '../src/data/repo'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'

const ACTIVITY_OPTIONS: ReadonlyArray<{ id: ActivityLevel; label: string; hint: string }> = [
  { id: 'sedentary', label: 'Siedząca', hint: 'Praca przy biurku, mało ruchu' },
  { id: 'light', label: 'Lekka', hint: '1 do 3 treningów w tygodniu albo dużo chodzenia' },
  { id: 'moderate', label: 'Umiarkowana', hint: '3 do 5 treningów w tygodniu' },
  { id: 'active', label: 'Wysoka', hint: '6 do 7 treningów w tygodniu albo praca na nogach' },
  { id: 'very_active', label: 'Bardzo wysoka', hint: 'Ciężka praca fizyczna plus treningi' },
]

/**
 * Edit nutrition goals.
 *
 * Two rules carried over from the engine, because a settings screen that breaks
 * them re-introduces the exact bug the engine was built to prevent:
 *
 *   CARBS ARE THE DERIVED VARIABLE. Editing calories, protein or fat re-solves
 *   carbs as the remainder. There is always exactly one dependent value, so the
 *   four numbers can never drift out of agreement.
 *
 *   SAVING TURNS THE ADAPTIVE LOOP OFF. Silently overwriting a target someone
 *   deliberately typed is the fastest way to lose their trust in every other
 *   number in the app.
 */
export default function EditGoals() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [base, setBase] = useState<CurrentGoal | null>(null)
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [fat, setFat] = useState('')
  const [saving, setSaving] = useState(false)
  const [recalc, setRecalc] = useState<RecomputedGoal | null>(null)
  const [activity, setActivity] = useState<ActivityLevel | null>(null)

  useEffect(() => {
    let alive = true
    void currentGoal().then((g) => {
      if (!alive || !g) return
      setBase(g)
      setKcal(String(Math.round(g.targetKcal)))
      setProtein(String(Math.round(g.protein_g)))
      setFat(String(Math.round(g.fat_g)))
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    void recomputeGoalFromProfile(Date.now(), activity ?? undefined).then((r) => {
      if (!alive) return
      setRecalc(r)
      if (r && activity == null) setActivity(r.activity)
    })
    return () => {
      alive = false
    }
  }, [activity])

  async function applyRecalc() {
    if (!recalc || saving) return
    setSaving(true)
    await applyRecomputedGoal(recalc, Date.now())
    router.back()
  }

  const n = (s: string) => {
    const v = Number.parseFloat(s.replace(',', '.'))
    return Number.isFinite(v) && v >= 0 ? v : 0
  }

  const kcalV = n(kcal)
  const proteinV = n(protein)
  const fatV = n(fat)
  // The single derived value.
  const carbsV = Math.max(0, (kcalV - 4 * proteinV - 9 * fatV) / 4)
  const impossible = kcalV > 0 && 4 * proteinV + 9 * fatV > kcalV

  async function save() {
    if (!base || saving || kcalV <= 0 || impossible) return
    setSaving(true)
    await overrideTargets(
      {
        targetKcal: kcalV,
        macros: { protein_g: proteinV, fat_g: fatV, carbs_g: carbsV, carbsFloored: carbsV === 0 },
      },
      base,
      Date.now(),
    )
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg }}>
      <View style={styles.head}>
        <Text style={[type.title, { color: theme.text }]}>Cele żywieniowe</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Anuluj</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }}>
        {recalc ? (
          <View style={[styles.recalc, { backgroundColor: theme.bgSunken }]}>
            <Text style={[type.bodyStrong, { color: theme.text }]}>Przelicz z profilu</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
              Aktywność to największa niewiadoma w tym wyliczeniu i potrafi zmienić wynik o kilkaset kcal.
              Wybierz ją według typowego tygodnia, nie najlepszego.
            </Text>
            <View style={{ marginTop: space.md, gap: space.sm }}>
              {ACTIVITY_OPTIONS.map((o) => {
                const selected = recalc.activity === o.id
                return (
                  <Pressable
                    key={o.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setActivity(o.id)}
                    style={[
                      styles.activityRow,
                      {
                        borderColor: selected ? theme.text : theme.border,
                        borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <Text style={[type.bodyStrong, { color: theme.text }]}>{o.label}</Text>
                    <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>{o.hint}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Text style={[type.caption, { color: theme.text, marginTop: space.md, lineHeight: 19 }]}>
              Dla ostatniej wagi {formatDecimal(recalc.weightKg, 1)} kg i wzrostu {formatInteger(recalc.heightCm)} cm
              wychodzi {formatInteger(recalc.target.target)} kcal: białko {formatInteger(recalc.macros.protein_g)} g,
              tłuszcz {formatInteger(recalc.macros.fat_g)} g, węglowodany {formatInteger(recalc.macros.carbs_g)} g.
              {recalc.target.floorExplanation ? ` ${recalc.target.floorExplanation}` : ''}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={applyRecalc}
              disabled={saving}
              style={[styles.recalcBtn, { borderColor: theme.border }]}
            >
              <Text style={[type.label, { color: theme.text }]}>Zastosuj i włącz cel adaptacyjny</Text>
            </Pressable>
          </View>
        ) : null}

        <Field label="Kalorie" unit="kcal" value={kcal} onChange={setKcal} />
        <Field label="Białko" unit="g" value={protein} onChange={setProtein} />
        <Field label="Tłuszcze" unit="g" value={fat} onChange={setFat} />

        <View style={[styles.derived, { backgroundColor: theme.bgSunken }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={[type.body, { color: theme.textMuted }]}>Węglowodany</Text>
            <Text style={[styles.big, { color: theme.text }]}>{Math.round(carbsV)} g</Text>
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 18 }]}>
            Węglowodany to zawsze reszta, więc Twoje cztery liczby nigdy nie będą ze sobą sprzeczne.
            Zmień kalorie, białko lub tłuszcz, a to przeliczy się na nowo.
          </Text>
        </View>

        {impossible ? (
          <View style={[styles.warn, { backgroundColor: theme.safetyBg }]}>
            <Text style={[type.caption, { color: theme.safety }]}>
              Samo białko i tłuszcz przekraczają już {Math.round(kcalV)} kcal
              ({Math.round(reconcileFromMacros(proteinV, 0, fatV))} kcal). Zwiększ kalorie albo
              zmniejsz któryś z tych składników.
            </Text>
          </View>
        ) : null}

        <View style={[styles.note, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text, lineHeight: 18 }]}>
            Zapis wyłącza cel adaptacyjny. Nie nadpiszemy po cichu liczby wybranej celowo. Adaptację
            włączysz ponownie przyciskiem w karcie „Przelicz z profilu”.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg }]}>
        <Pressable
          onPress={save}
          disabled={kcalV <= 0 || impossible || saving}
          style={[styles.cta, { backgroundColor: kcalV > 0 && !impossible ? theme.text : theme.border }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>Zapisz</Text>
        </Pressable>
      </View>
    </View>
  )
}

function Field({
  label, unit, value, onChange,
}: {
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
}) {
  const theme = useTheme()
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={[type.label, { color: theme.textMuted, marginBottom: space.xs }]}>{label}</Text>
      <View style={[styles.field, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
        <TextInput
          keyboardType="number-pad"
          value={value}
          onChangeText={onChange}
          accessibilityLabel={`${label} (${unit})`}
          style={[styles.input, { color: theme.text }]}
        />
        <Text style={[type.body, { color: theme.textMuted }]}>{unit}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, minHeight: 56,
  },
  input: { flex: 1, fontSize: 22, fontWeight: '700', paddingVertical: space.md },
  derived: { padding: space.lg, borderRadius: radius.lg },
  recalc: { padding: space.lg, borderRadius: radius.lg, marginBottom: space.lg },
  activityRow: { padding: space.md, borderRadius: radius.md },
  recalcBtn: {
    alignSelf: 'flex-start', marginTop: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth,
  },
  big: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6 },
  warn: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  note: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg },
  cta: { height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})
