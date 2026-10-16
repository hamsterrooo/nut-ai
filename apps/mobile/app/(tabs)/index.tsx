import { formatInteger, pluralPl } from '../../src/i18n/format'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../../src/components/Icon'
import { NutrientCard } from '../../src/components/NutrientCard'
import {
  currentGoal,
  dayTotals,
  localDate,
  runAdaptive,
  type AdaptiveOutcome,
  type CurrentGoal,
  type DayTotals,
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
  const { width } = useWindowDimensions()

  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [totals, setTotals] = useState<DayTotals | null>(null)
  const [adaptive, setAdaptive] = useState<AdaptiveOutcome | null>(null)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState(0)

  const selected = useMemo(() => Date.now() + offset * 86_400_000, [offset])

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        // The adaptive loop runs BEFORE reading the goal, so a target it just
        // changed is the one rendered. Its own gates decide whether it may act.
        const outcome = await runAdaptive(Date.now())
        const [g, t] = await Promise.all([currentGoal(), dayTotals(localDate(selected))])
        if (!alive) return
        setAdaptive(outcome)
        setGoal(g)
        setTotals(t)
      })()
      return () => {
        alive = false
      }
    }, [selected]),
  )

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
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: 150 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.wordmark, { color: theme.text }]}>Nut AI</Text>
        <View style={[styles.streakPill, { backgroundColor: theme.bgSunken }]}>
          <Icon name="flame" size={16} color={theme.text} />
          <Text style={[type.bodyStrong, { color: theme.text }]}>0</Text>
        </View>
      </View>

      {/* Day strip */}
      <DayStrip selected={offset} onSelect={setOffset} />

      {/* Paged carousel. pagingEnabled snaps by the VIEWPORT width, so each
          page must be exactly `width` wide with its own internal padding —
          sizing pages narrower and padding the container makes every swipe
          drift further off-grid, clipping the left card and bleeding the
          neighbor in. That was the "30g Fiber left" cut-off. */}
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) =>
          setPage(Math.round(e.nativeEvent.contentOffset.x / width))
        }
        style={{ marginTop: space.md }}
      >
        {/* Page 1 — every tracked value on one card, all with the same weight.
            Fiber, sugar and sodium targets are fixed defaults for now. */}
        <View style={{ width, paddingHorizontal: space.lg }}>
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

        {/* Page 2 — water */}
        <View style={{ width, paddingHorizontal: space.lg }}>
          <View style={[styles.card, { backgroundColor: theme.bgElevated, borderColor: theme.border, marginTop: space.md }]}>
            <View style={styles.spread}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Icon name="water" size={22} color={theme.protein} />
                <View>
                  <Text style={[type.caption, { color: theme.textMuted }]}>Woda</Text>
                  <Text style={[type.bodyStrong, { color: theme.text }]}>0 ml</Text>
                </View>
              </View>
              <Pressable style={[styles.ghost, { borderColor: theme.border }]}>
                <Text style={[type.label, { color: theme.text }]}>Dodaj wodę</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Page dots */}
      <View style={styles.dots}>
        {[0, 1].map((i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: i === page ? theme.text : theme.border }]}
          />
        ))}
      </View>

      {/* Adaptive target status — always legible, never a silent change. */}
      <View style={{ paddingHorizontal: space.lg }}>
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
          <View style={[styles.card, { backgroundColor: theme.bgSunken, borderColor: 'transparent' }]}>
            <Text style={[type.bodyStrong, { color: theme.text }]}>
              Zapisano: {totals.mealCount} {pluralPl(totals.mealCount, 'posiłek', 'posiłki', 'posiłków')}
            </Text>
            {totals.pendingCount > 0 ? (
              <Text style={[type.caption, { color: theme.uncertain, marginTop: space.xs }]}>
                +{totals.pendingCount} w trakcie analizy, jeszcze nie liczone
              </Text>
            ) : null}
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
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
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
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, marginTop: space.lg },
  dot: { width: 7, height: 7, borderRadius: 4 },
  emptyCard: { marginTop: space.md, padding: space.lg, borderRadius: radius.xl },
  ghostRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.lg, borderRadius: radius.lg,
  },
  skeleton: { height: 8, borderRadius: 4 },
})
