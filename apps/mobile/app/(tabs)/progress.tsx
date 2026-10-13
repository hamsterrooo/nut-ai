import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Line as SvgLine, Path, Rect, Text as SvgText } from 'react-native-svg'
import { bmi, computeTrend, trendSlopeLbPerWeek, type TrendPoint, type WeightPoint } from '@nutai/goals'
import { currentGoal, db, setting, weightHistory, type CurrentGoal } from '../../src/data/repo'
import { Icon } from '../../src/components/Icon'
import { formatDecimal, formatInteger, pluralPl } from '../../src/i18n/format'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

const LB_PER_KG = 2.20462

const WINDOWS = [
  { key: '90D', label: '90 dni', days: 90 },
  { key: '6M', label: '6 mies.', days: 182 },
  { key: '1Y', label: '1 rok', days: 365 },
  { key: 'ALL', label: 'Całość', days: Number.POSITIVE_INFINITY },
] as const

const CHANGE_WINDOWS = [3, 7, 14, 30, 90] as const

export default function Progress() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [points, setPoints] = useState<WeightPoint[]>([])
  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [heightCm, setHeightCm] = useState<number | null>(null)
  const [goalKg, setGoalKg] = useState<number | null>(null)
  const [streak, setStreak] = useState(0)
  const [window, setWindow] = useState<(typeof WINDOWS)[number]['key']>('90D')

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        const h = await db()
        const [pts, g, target, profile, days] = await Promise.all([
          weightHistory(),
          currentGoal(),
          setting('goal.desiredWeightKg', ''),
          h.get<{ height_cm: number }>('SELECT height_cm FROM user_profile WHERE id = 1'),
          h.all<{ local_date: string }>('SELECT DISTINCT local_date FROM meals ORDER BY local_date DESC'),
        ])
        if (!alive) return
        setPoints(pts)
        setGoal(g)
        setGoalKg(target ? Number(target) : null)
        setHeightCm(profile?.height_cm ?? null)
        setStreak(countStreak(days.map((d) => d.local_date)))
      })()
      return () => {
        alive = false
      }
    }, []),
  )

  const trend = useMemo(() => computeTrend(points), [points])
  const raw = trend.filter((p) => p.rawKg != null)
  const slope = useMemo(() => trendSlopeLbPerWeek(trend), [trend])

  const currentKg = points[points.length - 1]?.weightKg ?? null
  const startKg = points[0]?.weightKg ?? null

  const pctOfGoal =
    startKg != null && currentKg != null && goalKg != null && Math.abs(goalKg - startKg) > 0.01
      ? Math.max(0, Math.min(1, (currentKg - startKg) / (goalKg - startKg)))
      : 0

  const visible = useMemo(() => {
    const w = WINDOWS.find((x) => x.key === window)
    if (!w || !Number.isFinite(w.days)) return trend
    const last = trend[trend.length - 1]
    if (!last) return trend
    return trend.filter((p) => p.day > last.day - w.days)
  }, [trend, window])

  const bodyBmi = currentKg != null && heightCm != null ? bmi(currentKg, heightCm) : null

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 150 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[type.title, { color: theme.text }]}>Postępy</Text>

      {/* Streak credits logging INTENT, so our own failures never break it. */}
      <View style={styles.row}>
        <View style={[styles.tile, { backgroundColor: theme.bgSunken }]}>
          <Icon name="flame" size={30} color={theme.text} />
          <Text style={[styles.tileNum, { color: theme.text }]}>{streak}</Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>Dni z rzędu</Text>
        </View>
        <View style={[styles.tile, { backgroundColor: theme.bgSunken }]}>
          <Icon name="scale" size={30} color={theme.text} />
          <Text style={[styles.tileNum, { color: theme.text }]}>{raw.length}</Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>Ważenia</Text>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <View style={styles.spread}>
          <Text style={[type.caption, { color: theme.textMuted }]}>Aktualna waga</Text>
          <Pressable onPress={() => router.push('/log-weight' as never)} hitSlop={space.sm}>
            <Text style={[type.label, { color: theme.protein }]}>Zapisz wagę</Text>
          </Pressable>
        </View>
        <Text style={[styles.big, { color: theme.text }]}>
          {currentKg != null ? `${formatDecimal(currentKg)} kg` : '—'}
        </Text>

        <View style={[styles.bar, { backgroundColor: theme.ringTrack }]}>
          <View style={{ width: `${pctOfGoal * 100}%`, height: 6, borderRadius: 3, backgroundColor: theme.text }} />
        </View>
        <View style={styles.spread}>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            Start: {startKg != null ? `${formatDecimal(startKg)} kg` : '—'}
          </Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            Cel: {goalKg != null ? `${formatDecimal(goalKg)} kg` : '—'}
          </Text>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <View style={styles.spread}>
          <Text style={[type.heading, { color: theme.text }]}>Postęp wagi</Text>
          <View style={[styles.badge, { backgroundColor: theme.bgElevated }]}>
            <Text style={[type.caption, { color: theme.text }]}>{Math.round(pctOfGoal * 100)}% celu</Text>
          </View>
        </View>

        {raw.length === 0 ? (
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md }]}>
            Brak ważeń. Potrzeba około pięciu, zanim nachylenie trendu cokolwiek znaczy.
          </Text>
        ) : (
          <WeightChart trend={visible} />
        )}

        <View style={[styles.segment, { backgroundColor: theme.bgElevated }]}>
          {WINDOWS.map((w) => (
            <Pressable
              key={w.key}
              onPress={() => setWindow(w.key)}
              style={[styles.segItem, window === w.key && { backgroundColor: theme.bg }]}
            >
              <Text style={[type.label, { color: window === w.key ? theme.text : theme.textMuted }]}>
                {w.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: theme.textFaint }]} />
            <Text style={[type.caption, { color: theme.textMuted }]}>Każde ważenie</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.line, { backgroundColor: theme.text }]} />
            <Text style={[type.caption, { color: theme.textMuted }]}>Trend</Text>
          </View>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.heading, { color: theme.text }]}>Zmiany wagi</Text>
        {CHANGE_WINDOWS.map((d) => (
          <ChangeRow key={d} label={`${d} dni`} kg={changeOver(trend, d)} />
        ))}
        <ChangeRow label="Całość" kg={changeOver(trend, Number.POSITIVE_INFINITY)} />
        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, lineHeight: 18 }]}>
          Liczone na linii trendu, a nie na pojedynczych ważeniach. Skok o 1,5 kg w ciągu nocy to
          woda, a pokazywanie go jako zmiany byłoby pokazywaniem szumu jako postępu.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.heading, { color: theme.text }]}>Tempo zmiany</Text>
        <Text style={[styles.big, { color: theme.text }]}>
          {slope == null ? '—' : `${slope > 0 ? '+' : ''}${formatDecimal(slope / LB_PER_KG, 2)} kg/tydz.`}
        </Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {slope == null ? 'Za mało ważeń.' : `Na podstawie ${raw.length} ${pluralPl(raw.length, 'ważenia', 'ważeń', 'ważeń')}.`}
        </Text>
      </View>

      {bodyBmi != null ? (
        <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>Twoje BMI</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
            <Text style={[styles.big, { color: theme.text }]}>{formatDecimal(bodyBmi)}</Text>
            <Text style={[type.caption, { color: theme.textMuted }]}>{bmiBand(bodyBmi)}</Text>
          </View>
          <BmiScale value={bodyBmi} />
          <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, lineHeight: 18 }]}>
            BMI nie odróżnia mięśni od tłuszczu i nic nie mówi o zdrowiu konkretnej osoby. Jest tu,
            bo to powszechny punkt odniesienia, a nie wyrok.
          </Text>
        </View>
      ) : null}

      {goal ? (
        <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>Dzienny cel</Text>
          <Text style={[styles.big, { color: theme.text }]}>{formatInteger(goal.targetKcal)} kcal</Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            {goal.adaptive ? 'Dostosowuje się do Twojego trendu i spożycia.' : 'Stały, ustawiony ręcznie.'}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  )
}

/** Consecutive logged days ending today, or yesterday if today is still open. */
function countStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const set = new Set(dates)
  const day = 86_400_000
  let n = 0
  let cursor = Date.now()
  // A day still in progress must not break a streak that is otherwise intact.
  if (!set.has(iso(cursor))) cursor -= day
  while (set.has(iso(cursor))) {
    n++
    cursor -= day
  }
  return n
}

function iso(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Change over N days, measured on the TREND rather than raw entries. */
function changeOver(trend: TrendPoint[], days: number): number | null {
  const last = trend[trend.length - 1]
  const first = trend[0]
  if (!last || !first) return null
  const target = Number.isFinite(days) ? last.day - days : first.day
  const start = [...trend].reverse().find((p) => p.day <= target) ?? first
  return last.trendKg - start.trendKg
}

function ChangeRow({ label, kg }: { label: string; kg: number | null }) {
  const theme = useTheme()
  const none = kg == null || Math.abs(kg) < 0.05
  const up = (kg ?? 0) > 0
  return (
    <View style={styles.changeRow}>
      <Text style={[type.body, { color: theme.textMuted, width: 78 }]}>{label}</Text>
      <Text style={[type.bodyStrong, { color: theme.text, flex: 1 }]}>
        {kg == null ? '—' : `${kg > 0 ? '+' : ''}${formatDecimal(kg)} kg`}
      </Text>
      <Text style={[type.caption, { color: none ? theme.textMuted : theme.protein }]}>
        {none ? 'Bez zmian' : up ? 'Wzrost' : 'Spadek'}
      </Text>
    </View>
  )
}

function WeightChart({ trend }: { trend: TrendPoint[] }) {
  const theme = useTheme()
  const W = 300
  const H = 170

  if (trend.length === 0) return null

  const values = trend.flatMap((p) => [p.trendKg, ...(p.rawKg != null ? [p.rawKg] : [])])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min < 0.5 ? 1 : max - min
  const pad = span * 0.2

  const x = (i: number) => (trend.length <= 1 ? W / 2 : (i / (trend.length - 1)) * (W - 50) + 40)
  const y = (kg: number) => H - 24 - ((kg - min + pad) / (span + pad * 2)) * (H - 48)

  const gridVals = [min + span, min + span / 2, min]
  let d = ''
  trend.forEach((p, i) => {
    d += `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.trendKg)} `
  })

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: space.md }}>
      {gridVals.map((v, i) => (
        <SvgLine key={i} x1={40} y1={y(v)} x2={W - 10} y2={y(v)} stroke={theme.border} strokeWidth="1" />
      ))}
      {gridVals.map((v, i) => (
        <SvgText key={`t${i}`} x={2} y={y(v) + 4} fontSize="10" fill={theme.textFaint}>
          {formatDecimal(v, 0)}
        </SvgText>
      ))}
      {trend.map((p, i) =>
        p.rawKg != null ? <Circle key={i} cx={x(i)} cy={y(p.rawKg)} r="3" fill={theme.textFaint} /> : null,
      )}
      <Path d={d} stroke={theme.text} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

function bmiBand(v: number): string {
  if (v < 18.5) return 'Niedowaga'
  if (v < 25) return 'Waga prawidłowa'
  if (v < 30) return 'Nadwaga'
  return 'Otyłość'
}

function BmiScale({ value }: { value: number }) {
  const theme = useTheme()
  const W = 300
  const pos = Math.max(0, Math.min(1, (value - 15) / 20))
  const segs = [
    { w: (18.5 - 15) / 20, c: '#6E9BFF' },
    { w: (25 - 18.5) / 20, c: '#2E9E6B' },
    { w: (30 - 25) / 20, c: '#F2A93B' },
    { w: (35 - 30) / 20, c: '#D5453B' },
  ]
  let cursor = 0
  return (
    <Svg width="100%" height={26} viewBox={`0 0 ${W} 26`} style={{ marginTop: space.md }}>
      {segs.map((s, i) => {
        const x = cursor * W
        cursor += s.w
        return <Rect key={i} x={x} y={9} width={s.w * W - 3} height={8} rx={4} fill={s.c} />
      })}
      <Rect x={pos * W - 1.5} y={3} width={3} height={20} rx={1.5} fill={theme.text} />
    </Svg>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  tile: { flex: 1, padding: space.lg, borderRadius: radius.xl, alignItems: 'center' },
  tileNum: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, marginTop: space.xs },
  card: { marginTop: space.md, padding: space.lg, borderRadius: radius.xl },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  big: { fontSize: 30, fontWeight: '800', letterSpacing: -1, marginTop: space.xs },
  bar: { height: 6, borderRadius: 3, marginTop: space.md, marginBottom: space.sm, overflow: 'hidden' },
  badge: { paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill },
  segment: { flexDirection: 'row', borderRadius: radius.pill, padding: 3, marginTop: space.md },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.pill },
  legend: { flexDirection: 'row', gap: space.lg, marginTop: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  line: { width: 18, height: 3, borderRadius: 2 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
})
