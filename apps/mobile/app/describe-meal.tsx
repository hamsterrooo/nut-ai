import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useKeyboardHeight } from '../src/components/useKeyboardHeight'
import { startTextScan } from '../src/scan/orchestrator'
import { setPhase } from '../src/scan/store'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

/**
 * Describe a meal in words. The result lands on the normal review screen, so
 * every row stays editable and every assumption is shown.
 */
export default function DescribeMeal() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const kb = useKeyboardHeight()
  const [text, setText] = useState('')
  const ready = text.trim().length >= 3

  function submit() {
    const note = text.trim()
    if (note.length < 3) return
    setPhase({ kind: 'analyzing', photoUri: '', stage: 'identifying' })
    router.replace('/result')
    void startTextScan(note)
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg, paddingBottom: kb }}>
      <View style={styles.head}>
        <Text style={[type.title, { color: theme.text }]}>Opisz posiłek</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Anuluj</Text>
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: space.lg }}>
        <TextInput
          autoFocus
          multiline
          accessibilityLabel="Opis posiłku"
          placeholder="np. dwa jajka na maśle, kromka chleba żytniego i szklanka mleka 2%"
          placeholderTextColor={theme.textFaint}
          value={text}
          onChangeText={setText}
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
        />
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md, lineHeight: 19 }]}>
          Podaj ilości, jeśli je znasz: gramy, sztuki, łyżki. Bez nich przyjmę typową porcję i napiszę,
          co założyłem.
        </Text>
      </View>

      <View style={{ flex: 1 }} />

      <View style={[styles.actions, { paddingBottom: kb > 0 ? space.md : Math.max(insets.bottom, space.lg) }]}>
        <Pressable
          accessibilityRole="button"
          disabled={!ready}
          onPress={submit}
          style={[styles.primary, { backgroundColor: theme.text }, !ready && { opacity: 0.4 }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>Analizuj</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    marginBottom: space.lg,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 120,
    fontSize: 17,
    textAlignVertical: 'top',
  },
  actions: { paddingHorizontal: space.lg, paddingTop: space.md },
  primary: {
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
  },
})
