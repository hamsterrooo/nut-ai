import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MacroLine } from '../src/components/MacroLine'
import { db } from '../src/data/repo'
import {
  deleteSaved,
  listHistory,
  listSaved,
  logAgain,
  logSaved,
  saveMeal,
  type HistoryEntry,
  type SavedEntry,
} from '../src/data/saved-meals'
import { formatDate, formatInteger, pluralPl } from '../src/i18n/format'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * History and saved entries on one screen. History is every logged meal, newest
 * first, and any of them can be added again or saved. Saved entries are the short
 * list worth one tap: a whole meal from the history, or a product saved from the
 * database search.
 */
export default function History() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<'history' | 'saved'>('history')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [saved, setSaved] = useState<SavedEntry[]>([])
  const [justSaved, setJustSaved] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const h = await db()
    const [hist, sv] = await Promise.all([listHistory(h), listSaved(h)])
    setHistory(hist)
    setSaved(sv)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function addToToday(run: (h: Awaited<ReturnType<typeof db>>) => Promise<number | null>) {
    if (busy) return
    setBusy(true)
    try {
      await run(await db())
      router.back()
    } finally {
      setBusy(false)
    }
  }

  async function save(e: HistoryEntry) {
    await saveMeal(await db(), e.id, Date.now())
    setJustSaved((s) => [...s, e.id])
    await load()
  }

  function confirmDelete(e: SavedEntry) {
    Alert.alert('Usunąć z zapisanych?', e.name, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteSaved(await db(), e.id)
            await load()
          })()
        },
      },
    ])
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg }}>
      <View style={styles.head}>
        <Text style={[type.title, { color: theme.text }]}>Historia</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Gotowe</Text>
        </Pressable>
      </View>

      <View style={[styles.segment, { backgroundColor: theme.bgSunken }]}>
        {(
          [
            { key: 'history', label: 'Historia' },
            { key: 'saved', label: `Zapisane${saved.length > 0 ? ` (${saved.length})` : ''}` },
          ] as const
        ).map((t) => (
          <Pressable
            key={t.key}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === t.key }}
            onPress={() => setTab(t.key)}
            style={[styles.segItem, tab === t.key && { backgroundColor: theme.bgElevated }]}
          >
            <Text style={[type.label, { color: tab === t.key ? theme.text : theme.textMuted }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }}>
        {tab === 'history' ? (
          history.length === 0 ? (
            <Text style={[type.body, { color: theme.textMuted }]}>Nic jeszcze nie dodano.</Text>
          ) : (
            history.map((e, idx) => {
              const d = new Date(e.loggedAt)
              const newDay = idx === 0 || new Date(history[idx - 1]!.loggedAt).toDateString() !== d.toDateString()
              const isSaved = justSaved.includes(e.id)
              return (
                <View key={e.id}>
                  {newDay ? (
                    <Text style={[type.label, { color: theme.textMuted, marginTop: idx === 0 ? 0 : space.lg, marginBottom: space.sm }]}>
                      {formatDate(d, { withYear: d.getFullYear() !== new Date().getFullYear() })}
                    </Text>
                  ) : null}
                  <View style={[styles.row, { backgroundColor: theme.bgSunken }]}>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={2} style={[type.bodyStrong, { color: theme.text }]}>{e.name}</Text>
                      <MacroLine
                        lead={`${pad(d.getHours())}:${pad(d.getMinutes())} · ${formatInteger(e.kcal)} kcal`}
                        carbs={e.carbs_g}
                        protein={e.protein_g}
                        fat={e.fat_g}
                      />
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Dodaj ponownie: ${e.name}`}
                      disabled={busy}
                      onPress={() => void addToToday((h) => logAgain(h, e.id, Date.now()))}
                      hitSlop={space.sm}
                      style={[styles.ghost, { borderColor: theme.border }]}
                    >
                      <Text style={[type.label, { color: theme.text }]}>Dodaj</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Zapisz: ${e.name}`}
                      disabled={isSaved}
                      onPress={() => void save(e)}
                      hitSlop={space.sm}
                      style={[styles.ghost, { borderColor: theme.border }]}
                    >
                      <Text style={[type.label, { color: isSaved ? theme.affirm : theme.textMuted }]}>
                        {isSaved ? 'Zapisano' : 'Zapisz'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )
            })
          )
        ) : saved.length === 0 ? (
          <Text style={[type.body, { color: theme.textMuted }]}>
            Zapisz posiłek z historii albo produkt z bazy, a dodasz go tu jednym dotknięciem.
          </Text>
        ) : (
          saved.map((e) => (
            <View key={e.id} style={[styles.row, { backgroundColor: theme.bgSunken, marginBottom: space.sm }]}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2} style={[type.bodyStrong, { color: theme.text }]}>{e.name}</Text>
                <MacroLine
                  lead={`${formatInteger(e.kcal)} kcal · ${e.items.length} ${pluralPl(e.items.length, 'składnik', 'składniki', 'składników')}`}
                  carbs={e.carbs_g}
                  protein={e.protein_g}
                  fat={e.fat_g}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Dodaj: ${e.name}`}
                disabled={busy}
                onPress={() => void addToToday((h) => logSaved(h, e.id, Date.now()))}
                hitSlop={space.sm}
                style={[styles.ghost, { borderColor: theme.border }]}
              >
                <Text style={[type.label, { color: theme.text }]}>Dodaj</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Usuń: ${e.name}`}
                onPress={() => confirmDelete(e)}
                hitSlop={space.sm}
                style={[styles.ghost, { borderColor: theme.border }]}
              >
                <Text style={[type.label, { color: theme.textMuted }]}>Usuń</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  segment: { flexDirection: 'row', borderRadius: radius.pill, padding: 3, marginHorizontal: space.lg, marginTop: space.lg },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.pill },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg, borderRadius: radius.lg },
  ghost: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
})
