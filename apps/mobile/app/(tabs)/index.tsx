import { formatDecimal, formatInteger, pluralPl } from '../../src/i18n/format'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../../src/components/Icon'
import { MacroLine } from '../../src/components/MacroLine'
import { PressableScale } from '../../src/components/motion'
import { NutrientCard } from '../../src/components/NutrientCard'
import {
  db,
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
import { mergeMeals } from '../../src/data/meal-edit'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/** Exact meals (barcode, label, product database) show to 0.1; photo estimates are whole. */
function amount(v: number, precise: boolean): string {
  return precise ? formatDecimal(v, 1) : formatInteger(v)
}

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
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const scrollRef = useRef<ScrollView>(null)
  // Set just before opening a modal from this screen, so closing it does not
  // throw the list back to the top.
  const keepScroll = useRef(false)

  const selected = useMemo(() => Date.now() + offset * 86_400_000, [offset])

  // Reset scroll position when coming back from another tab. expo-router keeps tab
  // screens mounted; a modal opened from here sets keepScroll and is skipped.
  useFocusEffect(
    useCallback(() => {
      if (keepScroll.current) {
        keepScroll.current = false
        return
      }
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

  function toggle(id: number) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  async function merge() {
    if (picked.length < 2) return
    await mergeMeals(await db(), picked)
    setSelecting(false)
    setPicked([])
    await reloadDay()
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

      {/* Shown only when the adaptive loop actually moved the target: never a silent change. */}
      {adaptive?.surfaced ? (
        <View style={{ paddingHorizontal: space.lg, marginTop: space.lg }}>
          <View style={[styles.card, { backgroundColor: theme.bgSunken, borderColor: 'transparent' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="target" size={18} color={theme.text} />
              <Text style={[type.bodyStrong, { color: theme.text }]}>Twój cel</Text>
            </View>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
              {`Zaktualizowano do ${formatInteger(adaptive.newKcal ?? 0)} kcal. ${adaptive.explanation}`}
            </Text>
          </View>
        </View>
      ) : null}

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
            <View style={styles.listHead}>
              <Text style={[type.caption, { color: theme.textMuted }]}>
                Zapisano: {totals.mealCount} {pluralPl(totals.mealCount, 'posiłek', 'posiłki', 'posiłków')}
              </Text>
              {selecting ? (
                <View style={{ flexDirection: 'row', gap: space.lg }}>
                  <Pressable
                    onPress={() => {
                      setSelecting(false)
                      setPicked([])
                    }}
                    hitSlop={space.sm}
                  >
                    <Text style={[type.label, { color: theme.textMuted }]}>Anuluj</Text>
                  </Pressable>
                  <Pressable
                    disabled={picked.length < 2}
                    onPress={() => void merge()}
                    hitSlop={space.sm}
                    style={{ opacity: picked.length < 2 ? 0.4 : 1 }}
                  >
                    <Text style={[type.label, { color: theme.protein }]}>Połącz ({picked.length})</Text>
                  </Pressable>
                </View>
              ) : meals.filter((m) => !m.pending).length > 1 ? (
                <Pressable onPress={() => setSelecting(true)} hitSlop={space.sm}>
                  <Text style={[type.label, { color: theme.protein }]}>Połącz w jeden posiłek</Text>
                </Pressable>
              ) : null}
            </View>
            {meals.map((m) => (
              <Pressable
                key={m.id}
                disabled={!selecting || m.pending}
                onPress={() => toggle(m.id)}
                style={[styles.mealRow, { backgroundColor: theme.bgSunken }]}
              >
                {selecting && !m.pending ? (
                  <View
                    style={[
                      styles.checkbox,
                      { borderColor: theme.text, backgroundColor: picked.includes(m.id) ? theme.text : 'transparent' },
                    ]}
                  >
                    {picked.includes(m.id) ? <Icon name="check" size={14} color={theme.bg} weight={2.4} /> : null}
                  </View>
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={2} style={[type.bodyStrong, { color: theme.text }]}>
                    {m.name}
                  </Text>
                  {m.pending ? (
                    <Text style={[type.caption, { color: theme.uncertain, marginTop: 2 }]}>
                      {`${m.time} · w trakcie analizy, jeszcze nie liczone`}
                    </Text>
                  ) : (
                    <MacroLine
                      lead={`${m.time} · ${amount(m.kcal, m.precise)} kcal`}
                      carbs={m.carbs_g}
                      protein={m.protein_g}
                      fat={m.fat_g}
                      decimals={m.precise ? 1 : 0}
                    />
                  )}
                  {m.note ? (
                    <Text numberOfLines={2} style={[type.caption, { color: theme.textFaint, marginTop: 2 }]}>
                      {m.note}
                    </Text>
                  ) : null}
                </View>
                {m.pending || selecting ? null : (
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`Edytuj posiłek: ${m.name}`}
                    onPress={() => {
                      keepScroll.current = true
                      router.push({ pathname: '/edit-meal', params: { id: String(m.id) } } as never)
                    }}
                    hitSlop={space.sm}
                    style={[styles.ghost, { borderColor: theme.border }]}
                  >
                    <Text style={[type.label, { color: theme.textMuted }]}>Edytuj</Text>
                  </PressableScale>
                )}
                {selecting ? null : (
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`Usuń posiłek: ${m.name}`}
                    onPress={() => confirmDelete(m)}
                    hitSlop={space.sm}
                    style={[styles.ghost, { borderColor: theme.border }]}
                  >
                    <Text style={[type.label, { color: theme.textMuted }]}>Usuń</Text>
                  </PressableScale>
                )}
              </Pressable>
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
  card: { padding: space.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
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
