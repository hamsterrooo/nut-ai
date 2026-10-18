import { formatInteger, pluralPl } from '../../src/i18n/format'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../../src/components/Icon'
import { PressableScale } from '../../src/components/motion'
import { NutrientCard } from '../../src/components/NutrientCard'
import {
  currentGoal,
  dayTotals,
  deleteMeal,
  localDate,
  mealsForDay,
  runAdaptive,
  type AdaptiveOutcome,
  type CurrentGoal,
  type DayTotals,
  type MealRow,
} from '../../src/data/repo'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

const DAY_LABELS = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb']

/**
 * Home.
 *
 * Three rules this screen will not break, all of them about not moralising:
 *
 *   A day with nothing logged reads "no entries logged" in a neutral colour.
 *   Never "missed", never red — red is reserved for safety warnings.
 *
 *   Over target is STATED, not scolded. The ring draws a second overflow arc
 *   rather than clamping at 100% and lying about it.
 *
 *   Pending scans contribute ZERO calories and show as a count. A number that
 *   silently grows later is worse than one that is visibly incomplete.
 */
export default function Home() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [totals, setTotals] = useState<DayTotals | null>(null)
  const [adaptive, setAdaptive] = useState<AdaptiveOutcome | null>(null)
  const [offset, setOffset] = useState(0)
  const [meals, setMeals] = useState<MealRow[]>([])
  const scrollRef = useRef<ScrollView>(null)

  const selected = useMemo(() => Date.now() + offset * 86_400_000, [offset])

  // Reset scroll position on every tab focus. expo-router keeps tab screens
  // mounted, so without this the scroll offset survives switching away and back.
  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false })
    }, []),
  )

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        // The adaptive loop runs BEFORE reading the goal, so a target it just
        // changed is the one rendered. Its own gates decide whether it may act.
        const outcome = await runAdaptive(Date.now())
        const date = localDate(selected)
        const [g, t, m] = await Promise.all([currentGoal(), dayTotals(date), mealsForDay(date)])
        if (!alive) return
        setAdaptive(outcome)
        setGoal(g)
        setTotals(t)
        setMeals(m)
      })()
      return () => {
        alive = false
      }
    }, [selected]),
  )

  // Totals and list only. The adaptive loop is not re-run after a deletion.
  const reloadDay = useCallback(async () => {
    const date = localDate(selected)
    const [t, m] = await Promise.all([dayTotals(date), mealsForDay(date)])
    setTotals(t)
    setMeals(m)
  }, [selected])

  function confirmDelete(m: MealRow) {
    Alert.alert('Usunąć posiłek?', m.name, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: () => {
          void deleteMeal(m.id).then(reloadDay)
        },
      },
    ])
  }

  if (!goal || !totals) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[type.body, { color: theme.textMuted }]}>Wczytywanie dnia…</Text>
      </View>
    )
  }

  const empty = totals.mealCount === 0 && totals.pendingCount === 0
  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: 150 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.wordmark, { color: theme.text }]}>Nut AI</Text>
      </View>

      {/* Day strip */}
      <DayStrip selected={offset} onSelect={setOffset} />

      {/* Every tracked value on one card, all with the same weight.
          Fiber, sugar and sodium targets are fixed defaults for now. */}
      <View style={{ paddingHorizontal: space.lg, marginTop: space.md }}>
        <NutrientCard
          rows={[
            { key: 'kcal', label: 'Kalorie', icon: 'flame', color: theme.text, value: totals.kcal, unit: 'kcal', target: goal.targetKcal, limit: true },
            { key: 'protein', label: 'Białko', icon: 'protein', color: theme.protein, value: totals.protein_g, unit: 'g', target: goal.protein_g },
            { key: 'carbs', label: 'Węglowodany', icon: 'carbs', color: theme.carbs, value: totals.carbs_g, unit: 'g', target: goal.carbs_g },
            { key: 'fat', label: 'Tłuszcz', icon: 'fat', color: theme.fat, value: totals.fat_g, unit: 'g', target: goal.fat_g },
            { key: 'fiber', label: 'Błonnik', icon: 'fiber', color: '#8B7BD8', value: totals.fiber_g, unit: 'g', target: 30 },
            { key: 'sugar', label: 'Cukry', icon: 'sugar', color: '#E88BA8', value: totals.sugar_g, unit: 'g', target: 50, limit: true },
            { key: 'sodium', label: 'Sód', icon: 'sodium', color: '#D6A648', value: totals.sodium_mg, unit: 'mg', target: 2300, limit: true },
          ]}
        />
      </View>

      {/* Adaptive target status — always legible, never a silent change. */}
      <View style={{ paddingHorizontal: space.lg, marginTop: space.lg }}>
        <View style={[styles.card, { backgroundColor: theme.bgSunken, borderColor: 'transparent' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="target" size={18} color={theme.text} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>Twój cel</Text>
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
            {adaptive?.surfaced
              ? `Zaktualizowano do ${formatInteger(adaptive.newKcal ?? 0)} kcal. ${adaptive.explanation}`
              : goal.adaptive
                ? (adaptive?.reason ?? 'Dostosowuje się do Twojego trendu i spożycia.')
                : 'Stały: ustawiono go ręcznie, więc go nie ruszamy.'}
          </Text>
          <Pressable
            onPress={() => router.push('/log-weight' as never)}
            hitSlop={space.sm}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.md }}
          >
            <Icon name="scale" size={16} color={theme.protein} />
            <Text style={[type.label, { color: theme.protein }]}>Zapisz dzisiejszą wagę</Text>
          </Pressable>
        </View>
      </View>

      {/* Recently uploaded */}
      <View style={{ paddingHorizontal: space.lg, marginTop: space.xl }}>
        <Text style={[type.title, { color: theme.text, fontSize: 24 }]}>Ostatnio dodane</Text>

        {empty ? (
          <View style={[styles.emptyCard, { backgroundColor: theme.bgSunken }]}>
            <View style={[styles.ghostRow, { backgroundColor: theme.bgElevated }]}>
              <Icon name="bowl" size={26} color={theme.textFaint} />
              <View style={{ flex: 1, gap: 6 }}>
                <View style={[styles.skeleton, { backgroundColor: theme.ringTrack, width: '70%' }]} />
                <View style={[styles.skeleton, { backgroundColor: theme.ringTrack, width: '45%' }]} />
              </View>
            </View>
            <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: space.lg }]}>
              Dotknij +, aby dodać pierwszy posiłek dnia
            </Text>
          </View>
        ) : (
          <View style={{ marginTop: space.md, gap: space.sm }}>
            <Text style={[type.caption, { color: theme.textMuted }]}>
              Zapisano: {totals.mealCount} {pluralPl(totals.mealCount, 'posiłek', 'posiłki', 'posiłków')}
            </Text>
            {meals.map((m) => (
              <View key={m.id} style={[styles.mealRow, { backgroundColor: theme.bgSunken }]}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={[type.bodyStrong, { color: theme.text }]}>
                    {m.name}
                  </Text>
                  <Text style={[type.caption, { color: m.pending ? theme.uncertain : theme.textMuted, marginTop: 2 }]}>
                    {m.time} · {m.pending ? 'w trakcie analizy, jeszcze nie liczone' : `${formatInteger(m.kcal)} kcal`}
                  </Text>
                </View>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Usuń posiłek: ${m.name}`}
                  onPress={() => confirmDelete(m)}
                  hitSlop={space.sm}
                  style={[styles.ghost, { borderColor: theme.border }]}
                >
                  <Text style={[type.label, { color: theme.textMuted }]}>Usuń</Text>
                </PressableScale>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  )
}

function DayStrip({ selected, onSelect }: { selected: number; onSelect: (o: number) => void }) {
  const theme = useTheme()
  const now = new Date()
  // Monday-first week containing today.
  const dow = (now.getDay() + 6) % 7
  const days = Array.from({ length: 7 }, (_, i) => i - dow)

  return (
    <View style={styles.strip}>
      {days.map((off) => {
        const d = new Date(Date.now() + off * 86_400_000)
        const isSel = off === selected
        const future = off > 0
        return (
          <Pressable
            key={off}
            disabled={future}
            onPress={() => onSelect(off)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSel, disabled: future }}
            style={[styles.dayCol, isSel && { backgroundColor: theme.bgElevated }]}
          >
            <Text style={[type.caption, { color: future ? theme.textFaint : theme.textMuted }]}>
              {DAY_LABELS[d.getDay()]}
            </Text>
            <View
              style={[
                styles.dayCircle,
                {
                  borderColor: isSel ? theme.text : theme.border,
                  borderStyle: off < 0 ? 'dashed' : 'solid',
                  opacity: future ? 0.4 : 1,
                },
              ]}
            >
              <Text style={[type.bodyStrong, { color: future ? theme.textFaint : theme.text }]}>
                {d.getDate()}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  wordmark: { fontSize: 30, fontWeight: '800', letterSpacing: -1.2 },
  strip: { flexDirection: 'row', paddingHorizontal: space.md, marginTop: space.lg },
  dayCol: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.lg, gap: space.sm },
  dayCircle: {
    width: 40, height: 40, borderRadius: radius.pill, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  mid: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8 },
  card: { padding: space.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scoreTrack: { height: 8, borderRadius: 4, marginTop: space.md },
  ghost: {
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth,
  },
  mealRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.lg, borderRadius: radius.lg,
  },
  emptyCard: { marginTop: space.md, padding: space.lg, borderRadius: radius.xl },
  ghostRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.lg, borderRadius: radius.lg,
  },
  skeleton: { height: 8, borderRadius: 4 },
})
