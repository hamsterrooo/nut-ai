import * as Haptics from 'expo-haptics'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useKeyboardHeight } from '../src/components/useKeyboardHeight'
import { db, deleteMeal } from '../src/data/repo'
import { loadMealDetail, saveMealEdit, type MealDetail } from '../src/data/meal-edit'
import { formatDecimal } from '../src/i18n/format'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Edit a logged meal: its name, description, and the grams of every ingredient.
 * Values are recomputed from the per-100 g snapshots saved with the meal, so an
 * edit changes the quantity and never the nutrition data behind it.
 */
export default function EditMeal() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const kb = useKeyboardHeight()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [detail, setDetail] = useState<MealDetail | null>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [grams, setGrams] = useState<Record<number, string>>({})
  const [removed, setRemoved] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const d = await loadMealDetail(await db(), Number(id))
      if (!alive || !d) return
      setDetail(d)
      setTitle(d.title ?? '')
      setNote(d.note ?? '')
      setGrams(Object.fromEntries(d.items.map((i) => [i.id, String(Math.round(i.grams * 10) / 10).replace('.', ',')])))
    })()
    return () => {
      alive = false
    }
  }, [id])

  const parsed = (itemId: number, fallback: number) => {
    const n = Number((grams[itemId] ?? '').replace(',', '.'))
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }

  const live = useMemo(() => {
    if (!detail) return { kcal: 0, c: 0, p: 0, f: 0 }
    let kcal = 0
    let c = 0
    let p = 0
    let f = 0
    for (const i of detail.items) {
      if (removed.includes(i.id)) continue
      const g = parsed(i.id, i.grams) / 100
      kcal += i.kcalPer100 * g
      c += i.carbsPer100 * g
      p += i.proteinPer100 * g
      f += i.fatPer100 * g
    }
    const k = detail.portionEaten
    return { kcal: kcal * k, c: c * k, p: p * k, f: f * k }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, grams, removed])

  async function save() {
    if (!detail || saving) return
    setSaving(true)
    try {
      const handle = await db()
      const remaining = detail.items.filter((i) => !removed.includes(i.id))
      if (remaining.length === 0) {
        await deleteMeal(detail.id)
      } else {
        await saveMealEdit(handle, detail.id, {
          title,
          note,
          grams: Object.fromEntries(remaining.map((i) => [i.id, parsed(i.id, i.grams)])),
          remove: removed,
        })
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.back()
    } catch {
      setSaving(false)
    }
  }

  if (!detail) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[type.body, { color: theme.textMuted }]}>Wczytywanie posiłku…</Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 160 }}
      >
        <View style={styles.head}>
          <Text style={[type.title, { color: theme.text }]}>Edytuj posiłek</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={space.md}>
            <Text style={[type.body, { color: theme.textMuted }]}>Anuluj</Text>
          </Pressable>
        </View>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
          Dodano o {clock(detail.loggedAt)}
        </Text>

        <TextInput
          accessibilityLabel="Nazwa posiłku"
          value={title}
          onChangeText={setTitle}
          placeholder="Nazwa posiłku"
          placeholderTextColor={theme.textFaint}
          style={[styles.field, { color: theme.text, borderColor: theme.border }]}
        />
        <TextInput
          accessibilityLabel="Opis posiłku"
          value={note}
          onChangeText={setNote}
          placeholder="Opis (opcjonalnie)"
          placeholderTextColor={theme.textFaint}
          multiline
          style={[styles.field, { color: theme.text, borderColor: theme.border, minHeight: 72, textAlignVertical: 'top' }]}
        />

        <View style={[styles.summary, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.bodyStrong, { color: theme.text }]}>{formatDecimal(live.kcal, 1)} kcal</Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            W {formatDecimal(live.c, 1)} g · B {formatDecimal(live.p, 1)} g · T {formatDecimal(live.f, 1)} g
          </Text>
        </View>

        <Text style={[type.label, { color: theme.textMuted, marginTop: space.xl }]}>Składniki</Text>
        {detail.items
          .filter((i) => !removed.includes(i.id))
          .map((i) => (
            <View key={i.id} style={[styles.row, { borderColor: theme.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { color: theme.text }]}>{i.name}</Text>
                <Text style={[type.micro, { color: theme.textMuted, marginTop: 2 }]}>dodano {clock(i.addedAt)}</Text>
              </View>
              <View style={[styles.gramBox, { borderColor: theme.border }]}>
                <TextInput
                  accessibilityLabel={`Masa w gramach: ${i.name}`}
                  keyboardType="numeric"
                  value={grams[i.id] ?? ''}
                  onChangeText={(t) => setGrams((g) => ({ ...g, [i.id]: t }))}
                  style={[styles.gramInput, { color: theme.text }]}
                />
                <Text style={[type.caption, { color: theme.textMuted }]}>g</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Usuń ${i.name}`}
                onPress={() => setRemoved((r) => [...r, i.id])}
                hitSlop={space.md}
                style={styles.remove}
              >
                <Text style={{ color: theme.textFaint, fontSize: 20 }}>×</Text>
              </Pressable>
            </View>
          ))}
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
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={() => void save()}
          style={[styles.primary, { backgroundColor: theme.text }, saving && { opacity: 0.6 }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>{saving ? 'Zapisywanie…' : 'Zapisz zmiany'}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  field: {
    marginTop: space.lg,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    fontSize: 16,
  },
  summary: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gramBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: MIN_TAP_TARGET,
  },
  gramInput: { minWidth: 48, textAlign: 'right', fontSize: 16 },
  remove: { width: MIN_TAP_TARGET, height: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primary: {
    paddingVertical: space.md,
    borderRadius: radius.pill,
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
