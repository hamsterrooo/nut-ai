import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'
import { useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { SelectedQuestion } from '@nutai/repair'
import { recomputeTotals } from '@nutai/totals'
import { Icon } from '../src/components/Icon'
import { MacroLine } from '../src/components/MacroLine'
import { NutrientCard } from '../src/components/NutrientCard'
import { ProductSuggestions } from '../src/components/ProductSuggestions'
import { useKeyboardHeight } from '../src/components/useKeyboardHeight'
import { PressableScale, enterItem } from '../src/components/motion'
import { logMeal } from '../src/data/repo'
import { isAnswerable } from '../src/scan/answers'
import { isPreciseMeal } from '../src/scan/precision'
import { fixScan, retryScan } from '../src/scan/orchestrator'
import {
  answerQuestion,
  editGrams,
  removeRow,
  reset,
  selectedAnswer,
  setNote,
  setTitle,
  useScan,
} from '../src/scan/store'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

/**
 * The result screen.
 *
 * SPEC-accuracy-engine.md §8.2, and ruling 2 of PLAN.md §3.3.
 *
 * ONE primary action: `Log it`. There is no `Fix Results` mode.
 *
 * That is not a simplification, it is the fix. A separate "fix mode" structurally
 * forces the interruption cost to be paid even when nothing is worth asking, and
 * it is what makes "re-analysis that deletes the ingredients you already
 * corrected" possible at all. THE REVIEW SCREEN IS THE FIX SCREEN. Every row is
 * editable in place, and every edit recomputes locally, instantly, for free.
 */
export default function Result() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const phase = useScan()
  const [logging, setLogging] = useState(false)
  const [fixOpen, setFixOpen] = useState(false)
  const [fixText, setFixText] = useState('')
  const kb = useKeyboardHeight()

  if (phase.kind === 'analyzing' || phase.kind === 'captured') {
    const stage = phase.kind === 'analyzing' ? phase.stage : 'preparing'
    const copy =
      stage === 'preparing'
        ? 'Przygotowanie zdjęcia…'
        : stage === 'identifying'
          ? 'Rozpoznawanie składników…'
          : 'Dopasowywanie do bazy żywieniowej…'
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        {phase.photoUri !== '' ? <Image source={{ uri: phase.photoUri }} style={styles.photo} /> : null}
        <ActivityIndicator color={theme.textMuted} style={{ marginTop: space.xl }} />
        <Text style={[type.heading, { color: theme.text, marginTop: space.md }]}>{copy}</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, textAlign: 'center' }]}>
          Zdjęcie jest zapisane. Nic nie przepadnie, jeśli się nie uda.
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md} style={{ marginTop: space.xl }}>
          <Text style={[type.body, { color: theme.textMuted }]}>Zamknij</Text>
        </Pressable>
      </View>
    )
  }

  if (phase.kind === 'failed') {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        {phase.photoUri !== '' ? (
          <Image source={{ uri: phase.photoUri }} style={[styles.photo, { opacity: 0.5 }]} />
        ) : null}
        <Text style={[type.heading, { color: theme.text, marginTop: phase.photoUri !== '' ? space.xl : 0, textAlign: 'center' }]}>
          {phase.headline ?? 'Nie udało się odczytać tego posiłku'}
        </Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, textAlign: 'center', lineHeight: 19 }]}>
          {phase.message}
        </Text>
        {phase.code ? (
          <Text selectable style={[type.micro, { color: theme.textFaint, marginTop: space.sm, textAlign: 'center' }]}>
            Kod: {phase.code}
          </Text>
        ) : null}
        {phase.canRetry ? (
          <Pressable
            onPress={() => void retryScan()}
            style={[styles.primary, { backgroundColor: theme.text, marginTop: space.xl, paddingHorizontal: space.xl }]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg }]}>Spróbuj ponownie</Text>
          </Pressable>
        ) : null}
        {phase.offerLabel ? (
          <Pressable
            onPress={() => { reset(); router.replace({ pathname: '/camera', params: { mode: 'label' } } as never) }}
            style={[styles.primary, { backgroundColor: phase.canRetry ? 'transparent' : theme.text, marginTop: space.xl, paddingHorizontal: space.xl }]}
          >
            <Text style={[type.bodyStrong, { color: phase.canRetry ? theme.text : theme.bg }]}>Zrób zdjęcie etykiety</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => { reset(); router.back() }}
          hitSlop={space.md}
          style={{ marginTop: space.lg }}
        >
          <Text style={[type.body, { color: theme.textMuted }]}>Zamknij</Text>
        </Pressable>
      </View>
    )
  }

  if (phase.kind !== 'ready') {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[type.heading, { color: theme.text }]}>Na razie nic do pokazania</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md} style={{ marginTop: space.xl }}>
          <Text style={[type.body, { color: theme.textMuted }]}>Zamknij</Text>
        </Pressable>
      </View>
    )
  }

  const { result } = phase
  // Only questions whose answer changes the numbers are shown. A chip that does
  // nothing (no sauce row to scale, no handler yet) is hidden rather than faked.
  // One card per question: a multi-item meal produces the same meal-level question
  // (portion, oil) once per item, and a highlighted copy beats a pre-answered one.
  const byId = new Map<string, SelectedQuestion>()
  for (const q of result.questions) {
    if (!isAnswerable(q.question.id, result.meal)) continue
    const prev = byId.get(q.question.id)
    if (!prev || (prev.state !== 'highlighted' && q.state === 'highlighted')) byId.set(q.question.id, q)
  }
  const answerable = [...byId.values()]
  const highlighted = answerable.filter((q) => q.state === 'highlighted')
  const preAnswered = answerable.filter((q) => q.state === 'pre_answered')

  const names = result.meal.ingredients.map((r) => r.displayName)
  const defaultTitle = names.length === 0 ? 'Twój posiłek' : names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} i ${names.length - 2} więcej`

  // Exact sources (barcode, label, a product picked by hand) show to 0.1; photo
  // estimates keep whole numbers so a guess never wears a decimal.
  const precise = isPreciseMeal(result.meal.ingredients)
  const shown = precise ? recomputeTotals(result.meal) : result.totals
  const dec = precise ? 1 : 0

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 150 }}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          accessibilityLabel="Nazwa posiłku"
          value={phase.title ?? ''}
          onChangeText={setTitle}
          placeholder={defaultTitle}
          placeholderTextColor={theme.text}
          returnKeyType="done"
          style={[type.title, { color: theme.text, padding: 0 }]}
        />
        <TextInput
          accessibilityLabel="Opis posiłku"
          value={phase.note ?? ''}
          onChangeText={setNote}
          placeholder="Dodaj opis (opcjonalnie)"
          placeholderTextColor={theme.textFaint}
          multiline
          style={[type.body, { color: theme.textMuted, marginTop: space.sm, padding: 0 }]}
        />

        <View style={{ marginTop: space.xl }}>
          <NutrientCard
            rows={[
              { key: 'kcal', label: 'Kalorie', icon: 'flame', color: theme.text, value: shown.kcal, unit: 'kcal', decimals: dec },
              { key: 'carbs', label: 'Węglowodany', icon: 'carbs', color: theme.carbs, value: shown.carbs_g, unit: 'g', decimals: dec },
              { key: 'protein', label: 'Białko', icon: 'protein', color: theme.protein, value: shown.protein_g, unit: 'g', decimals: dec },
              { key: 'fat', label: 'Tłuszcz', icon: 'fat', color: theme.fat, value: shown.fat_g, unit: 'g', decimals: dec },
              { key: 'fiber', label: 'Błonnik', icon: 'fiber', color: '#8B7BD8', value: shown.fiber_g, unit: 'g', decimals: dec },
              { key: 'sugar', label: 'Cukry', icon: 'sugar', color: '#E88BA8', value: shown.sugar_g, unit: 'g', decimals: dec },
              { key: 'sodium', label: 'Sód', icon: 'sodium', color: '#D6A648', value: shown.sodium_mg, unit: 'mg' },
            ]}
          />
        </View>

        {/* Highlighted questions: at most two, ever. */}
        {highlighted.map((q) => (
          <QuestionCard key={q.question.id} q={q} selected={selectedAnswer(phase, q.question.id)} />
        ))}

        {/* Every silent default stays visible, with the same one-tap chips. */}
        {preAnswered.map((q) => (
          <QuestionCard
            key={q.question.id}
            q={q}
            selected={selectedAnswer(phase, q.question.id)}
            subtitle={q.disclosure}
            muted
          />
        ))}

        <Text style={[type.label, { color: theme.textMuted, marginTop: space.xl }]}>Składniki</Text>

        {result.meal.ingredients.map((row, idx) => {
          const f = row.grams / 100
          const s = row.nutrientSnapshot
          return (
            <Animated.View key={row.id} entering={enterItem(idx)} style={[styles.ingCard, { backgroundColor: theme.bgSunken }]}>
              <View style={styles.ingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: theme.text }]}>{row.displayName}</Text>
                  {row.isEstimate ? (
                    <Text style={[type.micro, { color: theme.uncertain, marginTop: 2 }]}>SZACUNEK AI</Text>
                  ) : null}
                </View>

                <View style={[styles.gramBox, { borderColor: theme.border }]}>
                  <TextInput
                    accessibilityLabel={`Masa w gramach: ${row.displayName}`}
                    keyboardType="numeric"
                    defaultValue={String(Math.round(row.grams * 10) / 10).replace('.', ',')}
                    onChangeText={(t) => editGrams(row.id, Number(t.replace(',', '.')))}
                    style={[styles.gramInput, { color: theme.text }]}
                  />
                  <Text style={[type.caption, { color: theme.textMuted }]}>g</Text>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Usuń ${row.displayName}`}
                  onPress={() => removeRow(row.id)}
                  hitSlop={space.md}
                  style={styles.remove}
                >
                  <Text style={{ color: theme.textFaint, fontSize: 20 }}>×</Text>
                </Pressable>
              </View>
              <MacroLine
                lead={`${Math.round(s.kcal * f)} kcal`}
                carbs={s.carbs_g * f}
                protein={s.protein_g * f}
                fat={s.fat_g * f}
              />

              {row.origin === 'vision_model' || row.origin === 'db_search' ? <ProductSuggestions row={row} /> : null}
            </Animated.View>
          )
        })}
      </ScrollView>

      <View
        style={[
          styles.actions,
          {
            bottom: kb,
            paddingBottom: kb > 0 ? space.md : Math.max(insets.bottom, space.lg),
            backgroundColor: theme.bg,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <PressableScale
            accessibilityRole="button"
            onPress={() => setFixOpen(true)}
            style={[styles.secondary, { borderColor: theme.border }]}
          >
            <Icon name="pencil" size={16} color={theme.text} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>Popraw wynik</Text>
          </PressableScale>

          <Pressable
            accessibilityRole="button"
            disabled={logging}
            onPress={() => {
              if (logging) return
              setLogging(true)
              void (async () => {
                try {
                  await logMeal(result, phase.meta, phase.photoUri, Date.now(), {
                    title: phase.title ?? '',
                    note: phase.note ?? '',
                  })
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                  reset()
                  router.dismissAll()
                } catch {
                  setLogging(false)
                }
              })()
            }}
            style={[styles.primary, { flex: 1, backgroundColor: theme.text }, logging && { opacity: 0.6 }]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg }]}>{logging ? 'Zapisywanie…' : 'Zapisz'}</Text>
          </Pressable>
        </View>
      </View>

      {fixOpen ? (
        <View style={[styles.fixOverlay, { backgroundColor: theme.bg, paddingTop: insets.top + space.xl, paddingBottom: kb }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="pencil" size={20} color={theme.text} />
            <Text style={[type.title, { color: theme.text }]}>Popraw wynik</Text>
          </View>
          <TextInput
            autoFocus
            multiline
            placeholder="Opisz, co trzeba poprawić"
            placeholderTextColor={theme.textFaint}
            value={fixText}
            onChangeText={setFixText}
            style={[styles.fixInput, { color: theme.text, borderColor: theme.border }]}
          />
          <View style={[styles.fixExample, { backgroundColor: theme.bgSunken }]}>
            <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
              <Text style={{ fontWeight: '600' }}>Przykład:</Text> W wrapie brakuje kurczaka i
              awokado. Zmienia się tylko to, co wspomnisz, a Twoje inne poprawki zostają.
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            disabled={!fixText.trim()}
            onPress={() => {
              const note = fixText.trim()
              setFixOpen(false)
              setFixText('')
              if (note) void fixScan(note)
            }}
            style={[
              styles.primary,
              { backgroundColor: theme.text, marginBottom: kb > 0 ? space.md : Math.max(insets.bottom, space.lg) },
              !fixText.trim() && { opacity: 0.4 },
            ]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg }]}>Zaktualizuj</Text>
          </Pressable>
          <Pressable
            onPress={() => setFixOpen(false)}
            hitSlop={space.md}
            style={{ alignSelf: 'center', marginBottom: kb > 0 ? space.md : Math.max(insets.bottom, space.lg) }}
          >
            <Text style={[type.body, { color: theme.textMuted }]}>Anuluj</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

/**
 * One clarifying question with single-select, deselectable chips.
 *
 * The selected chip is filled. Tapping it again clears the answer and the
 * meal returns to the original estimate (see scan/answers.ts).
 */
function QuestionCard({
  q,
  selected,
  subtitle,
  muted,
}: {
  q: SelectedQuestion
  selected: string | null
  subtitle?: string
  muted?: boolean
}) {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.qCard,
        { borderColor: theme.uncertain, backgroundColor: muted ? theme.bgSunken : theme.uncertainBg },
      ]}
    >
      <Text style={[type.bodyStrong, { color: theme.text }]}>{q.text}</Text>
      {subtitle ? (
        <Text style={[type.micro, { color: theme.textMuted, marginTop: 2 }]}>{subtitle}</Text>
      ) : null}
      <View style={styles.chipRow}>
        {q.question.options.map((opt) => {
          const on = selected === opt.value
          return (
            <Pressable
              key={opt.value}
              onPress={() => {
                void Haptics.selectionAsync()
                answerQuestion(q, opt.value)
              }}
              hitSlop={space.sm}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: theme.uncertain,
                  backgroundColor: on ? theme.uncertain : 'transparent',
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[type.label, { color: on ? theme.bg : theme.text }]}>{opt.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  ingCard: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: MIN_TAP_TARGET,
  },
  fixOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: space.lg },
  fixInput: {
    marginTop: space.xl,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 88,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  fixExample: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  qCard: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg, borderWidth: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  gramBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingRight: space.md,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TAP_TARGET,
  },
  gramInput: {
    width: 56,
    textAlign: 'right',
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
  },
  photo: { width: 160, height: 160, borderRadius: radius.lg },
  remove: { width: MIN_TAP_TARGET, height: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primary: {
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
})
