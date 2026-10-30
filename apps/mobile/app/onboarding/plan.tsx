import { router } from 'expo-router'
import { useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  computeCalorieTarget,
  computeMacros,
  KCAL_PER_LB,
  type BodyInputs,
} from '@nutai/goals'
import { Icon, type IconName } from '../../src/components/Icon'
import { ProgressChart } from '../../src/components/onboarding/Charts'
import { persistOnboarding } from '../../src/onboarding/persist'
import { formatDate, formatDecimal, formatInteger } from '../../src/i18n/format'
import {
  ACTIVITY_LABEL_PL,
  activityFor,
  ageFrom,
  DIET_BIAS,
  inferredGoal,
  kgToLb,
  LB_PER_KG,
  useAnswers,
} from '../../src/onboarding/store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * The plan reveal.
 *
 * This is where every earlier answer cashes out, and where we diverge hardest
 * from the reference — not in layout, but in what the screen is willing to claim.
 *
 * KEPT: the estimated-progress chart, the editable calorie and macro cards, the
 * "Your info" recap, and "How to reach your goals". Those are genuinely useful.
 *
 * CUT, deliberately:
 *   - "Trusted by millions: 10M+ users, 4.8 stars". We have no users. Inventing
 *     social proof is fabricating a record, and a rating counter on a plan screen
 *     is a conversion device, not information.
 *   - The "Without Nut AI ❌ / With Nut AI ✅" comparison. It is an ad, placed
 *     where a person is looking at their own body data.
 *
 * ADDED: the arithmetic. The reference shows 3826 kcal with no way to see where
 * it came from. Every number here can be traced, and the safety floor explains
 * itself in words whenever it fires.
 */
export default function PlanScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const a = useAnswers()

  const derivedGoal = inferredGoal(a)

  const plan = useMemo(() => {
    const nowMs = Date.now()
    const body: BodyInputs = {
      sex: a.sex ?? 'unspecified',
      weightKg: a.weightKg ?? 80,
      heightCm: a.heightCm ?? 170,
      ageYears: ageFrom(a, nowMs),
    }

    const currentKg = a.weightKg ?? 80
    const targetKg = a.desiredWeightKg ?? currentKg
    const deltaKg = Math.abs(targetKg - currentKg)
    // @nutai/goals does its arithmetic in pounds per week; that stays internal.
    const deltaLb = kgToLb(deltaKg)

    // A sane default rate, then let the floor clamp argue with it if it must.
    const rate = derivedGoal === 'maintain' ? 0 : Math.min(1, Math.max(0.25, deltaLb / 12))

    const target = computeCalorieTarget({
      ...body,
      activity: activityFor(a.workoutsPerWeek),
      goal: derivedGoal,
      rateLbPerWeek: rate,
    })
    const macros = computeMacros(target.target, body.weightKg, derivedGoal)

    // Target date from the actual arithmetic, not a flattering guess.
    const weeks = rate > 0 ? deltaLb / rate : 0
    const date = new Date(nowMs + weeks * 7 * 86_400_000)
    const dateLabel = formatDate(date)

    return { target, macros, deltaKg, dateLabel, rateKg: rate / LB_PER_KG, rateLb: rate }
  }, [a, derivedGoal])

  const gaining = derivedGoal === 'gain'
  const goalLine =
    derivedGoal === 'maintain'
      ? 'Cel: utrzymać wagę'
      : `Cel: ${gaining ? 'przytyć' : 'schudnąć'} ${formatDecimal(plan.deltaKg, 0)} kg do ${plan.dateLabel}`

  const diet = a.dietStyle ? DIET_BIAS[a.dietStyle] : null

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.xl,
          paddingBottom: 140,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center' }}>
          <View style={[styles.check, { backgroundColor: theme.text }]}>
            <Icon name="check" size={22} color={theme.bg} weight={2.4} />
          </View>
          <Text style={[styles.goal, { color: theme.text }]}>{goalLine}</Text>
        </View>

        <View style={{ marginTop: space.xl }}>
          <ProgressChart
            targetLabel={`${formatDecimal(a.desiredWeightKg ?? a.weightKg ?? 80)} kg`}
            dateLabel={derivedGoal === 'maintain' ? 'Na bieżąco' : plan.dateLabel}
            gaining={gaining}
          />
        </View>

        {/* Daily recommendation */}
        <View style={[styles.section, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>Twoje dzienne zalecenie</Text>

          <View style={[styles.bigCard, { backgroundColor: theme.bgElevated }]}>
            <View style={[styles.iconSq, { backgroundColor: theme.bgSunken }]}>
              <Icon name="flame" size={20} color={theme.text} />
            </View>
            <View>
              <Text style={[styles.bigNum, { color: theme.text }]}>
                {formatInteger(plan.target.target)}
              </Text>
              <Text style={[type.caption, { color: theme.textMuted }]}>Kalorie</Text>
            </View>
          </View>

          <View style={styles.macroRow}>
            <MacroCard label="Białko" value={plan.macros.protein_g} icon="protein" color={theme.protein} />
            <MacroCard label="Węglowodany" value={plan.macros.carbs_g} icon="carbs" color={theme.carbs} />
            <MacroCard label="Tłuszcze" value={plan.macros.fat_g} icon="fat" color={theme.fat} />
          </View>
        </View>

        {/* The floor clamp explains itself, in words, right where it applied. */}
        {plan.target.floorApplied ? (
          <View style={[styles.notice, { backgroundColor: theme.uncertainBg }]}>
            <Text style={[type.bodyStrong, { color: theme.text }]}>Podnieśliśmy Twój cel</Text>
            <Text style={[type.caption, { color: theme.text, marginTop: space.xs }]}>
              {plan.target.floorExplanation} Jedzenie poniżej tej granicy nie przybliża do celu,
              tylko spowalnia go i pogarsza samopoczucie.
            </Text>
          </View>
        ) : null}

        {plan.target.warnings.map((w) => (
          <View key={w} style={[styles.notice, { backgroundColor: theme.uncertainBg }]}>
            <Text style={[type.caption, { color: theme.text }]}>{w}</Text>
          </View>
        ))}

        {/* Where the number came from. The reference shows none of this. */}
        <View style={[styles.section, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>Skąd to się wzięło</Text>
          <View style={[styles.mathCard, { backgroundColor: theme.bgElevated }]}>
            <MathRow label="BMR (Mifflin-St Jeor)" value={`${formatInteger(plan.target.bmr)} kcal`} />
            <MathRow
              label={`× aktywność (${ACTIVITY_LABEL_PL[activityFor(a.workoutsPerWeek)]})`}
              value={`${formatInteger(plan.target.tdee)} kcal`}
            />
            {derivedGoal !== 'maintain' ? (
              <MathRow
                label={`${gaining ? '+' : '−'} ${formatDecimal(plan.rateKg, 2)} kg/tydzień`}
                value={`${gaining ? '+' : '−'}${formatInteger((plan.rateLb * KCAL_PER_LB) / 7)} kcal`}
              />
            ) : null}
            <MathRow label="Twój dzienny cel" value={`${formatInteger(plan.target.target)} kcal`} strong />
          </View>
        </View>

        {/* Your info */}
        <View style={[styles.section, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>Twoje dane</Text>
          <View style={[styles.mathCard, { backgroundColor: theme.bgElevated }]}>
            <InfoRow icon="person" label="Waga początkowa" value={`${formatDecimal(a.weightKg ?? 80)} kg`} />
            <InfoRow icon="target" label="Waga docelowa" value={`${formatDecimal(a.desiredWeightKg ?? a.weightKg ?? 80)} kg`} />
            <InfoRow icon="steps" label="Poziom aktywności" value={ACTIVITY_LABEL_PL[activityFor(a.workoutsPerWeek)] ?? ''} />
            {diet ? <InfoRow icon="bowl" label="Dieta" value={diet.label} /> : null}
          </View>
        </View>

        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.xl, lineHeight: 19 }]}>
          To szacunki z równań populacyjnych, a nie pomiary Twojego organizmu. Nut AI nie jest
          wyrobem medycznym. Popraw wszystko, co nie pasuje, a decyzje medyczne skonsultuj
          z dietetykiem lub lekarzem.
        </Text>
      </ScrollView>

      <View
        style={[
          styles.dock,
          { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg, borderTopColor: theme.border },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            // Persist BEFORE navigating. A plan the user saw but the app forgot
            // is worse than no plan: they would arrive at a Today screen whose
            // targets contradict the screen they just approved.
            void persistOnboarding(a, plan.target, plan.macros).then(() => {
              router.replace('/(tabs)' as never)
            })
          }}
          style={[styles.cta, { backgroundColor: theme.text }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>Zaczynamy!</Text>
        </Pressable>
      </View>
    </View>
  )
}

function MacroCard({ label, value, icon, color }: { label: string; value: number; icon: IconName; color: string }) {
  const theme = useTheme()
  return (
    <View style={[styles.macroCard, { backgroundColor: theme.bgElevated }]}>
      <View style={[styles.iconSq, { backgroundColor: theme.bgSunken, width: 34, height: 34 }]}>
        <Icon name={icon} size={18} color={color} />
      </View>
      <Text style={[styles.macroNum, { color: theme.text }]}>{Math.round(value)}g</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
        <Text style={[type.caption, { color: theme.textMuted }]}>{label}</Text>
      </View>
    </View>
  )
}

function MathRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const theme = useTheme()
  return (
    <View style={styles.mathRow}>
      <Text style={[strong ? type.bodyStrong : type.body, { color: strong ? theme.text : theme.textMuted, flex: 1 }]}>
        {label}
      </Text>
      <Text style={[type.bodyStrong, { color: theme.text }]}>{value}</Text>
    </View>
  )
}

function InfoRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={styles.mathRow}>
      <View style={{ width: 26 }}>
        <Icon name={icon} size={17} color={theme.textMuted} />
      </View>
      <Text style={[type.body, { color: theme.textMuted, flex: 1 }]}>{label}</Text>
      <Text style={[type.bodyStrong, { color: theme.text }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  check: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  goal: {
    fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: -1,
    textAlign: 'center', marginTop: space.lg,
  },
  section: { marginTop: space.xl, padding: space.lg, borderRadius: radius.xl },
  bigCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.lg,
    marginTop: space.md, padding: space.lg, borderRadius: radius.lg,
  },
  iconSq: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  bigNum: { fontSize: 38, fontWeight: '800', letterSpacing: -1.2 },
  macroRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  macroCard: { flex: 1, padding: space.md, borderRadius: radius.lg, gap: space.xs },
  macroNum: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  mathCard: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg, gap: space.md },
  mathRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  notice: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  cta: { height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})
