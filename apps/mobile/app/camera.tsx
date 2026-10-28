import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PressableScale } from '../src/components/motion'
import { Icon, type IconName } from '../src/components/Icon'
import { startBarcodeScan, startLabelScan, startScan } from '../src/scan/orchestrator'
import { basketSize, clearBasket, restoreBasket, setPhase } from '../src/scan/store'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

type CameraMode = 'food' | 'barcode' | 'label'

const SHORTCUTS: Array<{ label: string; short: string; icon: IconName; route: string }> = [
  { label: 'Baza produktów', short: 'Baza', icon: 'search', route: '/food-search' },
  { label: 'Zapisane produkty', short: 'Zapisane', icon: 'bookmark', route: '/saved-foods' },
]

const MODES: Array<{ id: CameraMode; label: string; icon: IconName }> = [
  { id: 'food', label: 'Jedzenie', icon: 'scan' },
  { id: 'barcode', label: 'Kod kreskowy', icon: 'barcode' },
  { id: 'label', label: 'Etykieta', icon: 'nutritionLabel' },
]

/**
 * Zoom steps. 0.5x switches to the ultra-wide lens when the phone has one; the
 * others are digital zoom on the main lens. expo-camera's `zoom` is 0..1 on a
 * logarithmic scale of the device's maximum, so these values are approximate:
 * tune them here if 2x and 3x look off on your phone.
 */
const ZOOM_STEPS: Array<{ label: string; ultra?: boolean; zoom: number }> = [
  { label: '0,5×', ultra: true, zoom: 0 },
  { label: '1×', zoom: 0 },
  { label: '2×', zoom: 0.15 },
  { label: '3×', zoom: 0.24 },
]

/**
 * Capture.
 *
 * SPEC-accuracy-engine.md §1.1 stages 0 and 1.
 *
 * THE SHUTTER ALWAYS SUCCEEDS. It writes a draft row before anything else can
 * fail — no key, no network, no model, no permission to analyze. A capture that
 * fails because the network is down loses the user's meal, and losing a meal is
 * unrecoverable in a way that a wrong number never is.
 *
 * Everything after the shutter — preprocessing, the model call, the pipeline —
 * lives in src/scan/orchestrator.ts and runs behind the result screen's
 * progress states. This screen's whole job is to hand off and get out of the
 * way fast.
 */
export default function Camera() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)
  const [busy, setBusy] = useState(false)
  const params = useLocalSearchParams<{ mode?: string }>()
  const [mode, setMode] = useState<CameraMode>(() => MODES.find((m) => m.id === params.mode)?.id ?? 'food')
  // Barcode frames arrive continuously; only the FIRST detection may fire.
  const barcodeFired = useRef(false)
  const [found, setFound] = useState(false)
  const [zoomIdx, setZoomIdx] = useState(1)
  const [ultraLens, setUltraLens] = useState<string | null>(null)
  const [parked, setParked] = useState(() => basketSize())

  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <Text style={[type.heading, { color: theme.text, textAlign: 'center' }]}>
          Nut AI potrzebuje dostępu do aparatu
        </Text>
        <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.sm }]}>
          Zdjęcia zostają na urządzeniu, chyba że podczas konfiguracji wybrano dostawcę w chmurze.
        </Text>
        <Pressable
          onPress={requestPermission}
          style={[styles.primary, { backgroundColor: theme.text, marginTop: space.xl }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>Zezwól na aparat</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={space.md} style={{ marginTop: space.lg }}>
          <Text style={[type.body, { color: theme.textMuted }]}>Nie teraz</Text>
        </Pressable>
      </View>
    )
  }

  /** From here on the draft exists and everything after can fail safely. */
  function handoff(uri: string) {
    setPhase({ kind: 'captured', photoUri: uri })
    // Navigate NOW. Preprocessing, the model call and the pipeline all run
    // behind the result screen's progress states.
    router.replace('/result')
    if (mode === 'label') void startLabelScan(uri)
    else void startScan(uri)
  }

  async function capture() {
    if (busy) return
    setBusy(true)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 1, skipProcessing: false })
      if (!shot?.uri) return
      handoff(shot.uri)
    } finally {
      setBusy(false)
    }
  }

  async function pickFromGallery() {
    if (busy) return
    setBusy(true)
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
      if (res.canceled || !res.assets[0]?.uri) return
      handoff(res.assets[0].uri)
    } finally {
      setBusy(false)
    }
  }

  function onBarcode(data: string) {
    if (barcodeFired.current || !data) return
    barcodeFired.current = true
    setFound(true)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    router.replace('/result')
    void startBarcodeScan(data)
  }

  const step = ZOOM_STEPS[zoomIdx]!
  const steps = ZOOM_STEPS.filter((z) => !z.ultra || ultraLens)

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        zoom={step.zoom}
        {...(step.ultra && ultraLens ? { selectedLens: ultraLens } : {})}
        onAvailableLensesChanged={(e) => {
          const ultra = e.lenses.find((l) => /ultra/i.test(l))
          if (ultra) setUltraLens(ultra)
        }}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={mode === 'barcode' ? ({ data }) => onBarcode(data) : undefined}
      />

      {mode === 'barcode' ? <BarcodeOverlay found={found} /> : null}

      <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, space.xl) }]}>
        <View style={styles.zoomRow}>
          {steps.map((z) => {
            const idx = ZOOM_STEPS.indexOf(z)
            const active = idx === zoomIdx
            return (
              <Pressable
                key={z.label}
                accessibilityRole="button"
                accessibilityLabel={`Powiększenie ${z.label}`}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  void Haptics.selectionAsync()
                  setZoomIdx(idx)
                }}
                hitSlop={space.xs}
                style={[styles.zoomChip, active && styles.zoomChipActive]}
              >
                <Text style={[type.label, { color: active ? '#000' : '#fff' }]}>{z.label}</Text>
              </Pressable>
            )
          })}
        </View>

        <View style={styles.modeRow}>
          {MODES.map((m) => {
            const active = mode === m.id
            return (
              <PressableScale
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={m.label}
                onPress={() => {
                  barcodeFired.current = false
                  setFound(false)
                  setMode(m.id)
                }}
                style={[styles.modePill, active && styles.modePillActive]}
              >
                <Icon name={m.icon} size={18} color={active ? '#000' : '#fff'} />
                <Text numberOfLines={1} style={[type.label, { color: active ? '#000' : '#fff', flexShrink: 1 }]}>{m.label}</Text>
              </PressableScale>
            )
          })}
        </View>

        {mode === 'barcode' ? (
          <Text style={[type.caption, styles.hint]}>Skieruj na kod kreskowy, zeskanuje się sam</Text>
        ) : (
          <View style={styles.shutterRow}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Wybierz zdjęcie z galerii"
              onPress={pickFromGallery}
              disabled={busy}
              style={styles.gallery}
            >
              <Icon name="image" size={22} color="#fff" />
            </PressableScale>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Zrób zdjęcie"
              onPress={capture}
              disabled={busy}
              style={[styles.shutter, busy && { opacity: 0.5 }]}
            />
            <View style={styles.gallery} />
          </View>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zamknij"
        onPress={() => router.back()}
        hitSlop={space.md}
        style={[styles.close, { top: insets.top + space.md }]}
      >
        <Text style={{ color: '#fff', fontSize: 22 }}>×</Text>
      </Pressable>

      {parked > 0 ? (
        <View style={[styles.basket, { top: insets.top + MIN_TAP_TARGET + space.xl }]}>
          <Text style={[type.label, { color: '#fff' }]}>
            Posiłek w toku: {parked} {parked === 1 ? 'składnik' : 'składników'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              restoreBasket()
              router.replace('/result')
            }}
            hitSlop={space.sm}
          >
            <Text style={[type.label, { color: '#fff', textDecorationLine: 'underline' }]}>Zapisz</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              clearBasket()
              setParked(0)
            }}
            hitSlop={space.sm}
          >
            <Text style={[type.label, { color: 'rgba(255,255,255,0.7)' }]}>Anuluj</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.shortcuts, { top: insets.top + space.md }]}>
        {SHORTCUTS.map((s) => (
          <PressableScale
            key={s.route}
            accessibilityRole="button"
            accessibilityLabel={s.label}
            onPress={() => router.replace(s.route as never)}
            style={styles.shortcut}
          >
            <Icon name={s.icon} size={16} color="#fff" />
            <Text style={[type.label, { color: '#fff' }]}>{s.short}</Text>
          </PressableScale>
        ))}
      </View>
    </View>
  )
}

/**
 * What the camera is doing in barcode mode: a frame to aim at, a moving line so it
 * is obvious the camera is searching, and a confirmation once a code is read.
 */
function BarcodeOverlay({ found }: { found: boolean }) {
  const y = useSharedValue(0)
  useEffect(() => {
    y.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }), -1, true)
  }, [y])
  const line = useAnimatedStyle(() => ({ transform: [{ translateY: y.value * (FRAME_H - 4) }] }))
  const color = found ? '#5BD08A' : '#fff'
  return (
    <View pointerEvents="none" style={styles.overlay}>
      <View style={styles.frame}>
        <View style={[styles.corner, styles.tl, { borderColor: color }]} />
        <View style={[styles.corner, styles.tr, { borderColor: color }]} />
        <View style={[styles.corner, styles.bl, { borderColor: color }]} />
        <View style={[styles.corner, styles.br, { borderColor: color }]} />
        {found ? null : <Animated.View style={[styles.scanLine, line]} />}
      </View>
      <View style={styles.overlayLabel}>
        <ActivityIndicator size="small" color="#fff" />
        <Text style={[type.label, { color: '#fff' }]}>
          {found ? 'Znaleziono kod, wczytuję produkt…' : 'Skanuję kod kreskowy…'}
        </Text>
      </View>
    </View>
  )
}

const FRAME_H = 150

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  frame: { width: '78%', height: FRAME_H },
  corner: { position: 'absolute', width: 28, height: 28, borderWidth: 4 },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 10 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 10 },
  scanLine: { position: 'absolute', left: 8, right: 8, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.85)' },
  overlayLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  zoomRow: { flexDirection: 'row', gap: space.sm, justifyContent: 'center' },
  zoomChip: {
    minWidth: 44,
    height: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomChipActive: { backgroundColor: '#fff' },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: space.xxl },
  gallery: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  basket: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  primary: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: space.lg },
  // 2x2 — four pills in one row overflow both screen edges on every iPhone.
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    width: '31.5%',
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    minHeight: MIN_TAP_TARGET,
  },
  modePillActive: { backgroundColor: '#fff' },
  hint: { color: 'rgba(255,255,255,0.85)', paddingVertical: space.lg },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: radius.pill,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  shortcuts: { position: 'absolute', right: space.lg, flexDirection: 'row', gap: space.sm },
  shortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: MIN_TAP_TARGET,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  close: {
    position: 'absolute',
    left: space.lg,
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
