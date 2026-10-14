import { Tabs, router } from 'expo-router'
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../../src/theme/tokens'

/**
 * Three tabs plus the detached FAB.
 *
 * GROUPS IS GONE. A social feed cannot be local-first without a server we
 * operate, it needs Apple 1.2 moderation machinery before it can ship at all,
 * and it is the highest eating-disorder-risk surface in this product category.
 * Cutting it is the decision, not a gap.
 *
 * The FAB is ALWAYS present and ALWAYS opens real logging. The reference
 * paywalls this button, which is the direct cause of its most-reported
 * complaint. No IAP is configured anywhere in this project, which is what leaves
 * App Store Guideline 3.1.1 nothing to attach to.
 */

const TABS: ReadonlyArray<{ name: string; label: string; icon: IconName }> = [
  { name: 'index', label: 'Dziś', icon: 'home' },
  { name: 'progress', label: 'Postępy', icon: 'chart' },
  { name: 'profile', label: 'Profil', icon: 'person' },
]

interface Action {
  label: string
  icon: IconName
  route: string
}

/** The main action gets the wide tile on top; the rest share one row below it. */
const PRIMARY_ACTION: Action = { label: 'Skanuj jedzenie', icon: 'scan', route: '/camera' }
const SECONDARY_ACTIONS: Action[] = [
  { label: 'Baza produktów', icon: 'search', route: '/food-search' },
  { label: 'Zapisane produkty', icon: 'bookmark', route: '/saved-foods' },
]

export default function TabLayout() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [sheetOpen, setSheetOpen] = useState(false)

  function openAction(a: Action) {
    setSheetOpen(false)
    router.push(a.route as never)
  }

  return (
    <>
      <Tabs
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.bg } }}
        tabBar={({ state, navigation }) => (
          <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
            <View style={[styles.pill, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
              {TABS.map((tab, i) => {
                const focused = state.index === i
                return (
                  <Pressable
                    key={tab.name}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: focused }}
                    accessibilityLabel={tab.label}
                    onPress={() => navigation.navigate(tab.name)}
                    style={[styles.tab, focused && { backgroundColor: theme.bgSunken }]}
                    hitSlop={space.sm}
                  >
                    <Icon name={tab.icon} size={21} color={focused ? theme.text : theme.textFaint} />
                    <Text style={[type.micro, { color: focused ? theme.text : theme.textFaint, marginTop: 1 }]}>
                      {tab.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dodaj"
              onPress={() => setSheetOpen(true)}
              style={[styles.fab, { backgroundColor: theme.text }]}
            >
              <Icon name="plus" size={26} color={theme.bg} weight={2.2} />
            </Pressable>
          </View>
        )}
      >
        {TABS.map((t) => (
          <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
        ))}
      </Tabs>

      <Modal visible={sheetOpen} transparent animationType="fade" onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)}>
          <View style={[styles.grid, { paddingBottom: Math.max(insets.bottom, space.md) + 90 }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => openAction(PRIMARY_ACTION)}
              style={[styles.actionWide, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
            >
              <Icon name={PRIMARY_ACTION.icon} size={28} color={theme.text} />
              <Text style={[type.bodyStrong, { color: theme.text }]}>{PRIMARY_ACTION.label}</Text>
            </Pressable>
            <View style={styles.row}>
              {SECONDARY_ACTIONS.map((a) => (
                <Pressable
                  key={a.label}
                  accessibilityRole="button"
                  onPress={() => openAction(a)}
                  style={[styles.action, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
                >
                  <Icon name={a.icon} size={28} color={theme.text} />
                  <Text style={[type.bodyStrong, { color: theme.text, marginTop: space.sm, textAlign: 'center' }]}>
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={[styles.closeWrap, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Zamknij"
              onPress={() => setSheetOpen(false)}
              style={[styles.fab, { backgroundColor: theme.text }]}
            >
              <Icon name="close" size={22} color={theme.bg} weight={2.2} />
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    borderRadius: radius.pill,
  },
  fab: {
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  grid: {
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  row: {
    flexDirection: 'row',
    gap: space.md,
  },
  action: {
    flex: 1,
    aspectRatio: 1.35,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionWide: {
    flexDirection: 'row',
    gap: space.md,
    paddingVertical: space.xl,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    paddingHorizontal: space.lg,
  },
})
