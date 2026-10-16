import { StyleSheet, Text, View } from 'react-native'
import { formatInteger } from '../i18n/format'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, type } from '../theme/tokens'
import { Icon, type IconName } from './Icon'

export interface NutrientRow {
  key: string
  label: string
  icon: IconName
  color: string
  value: number
  unit: string
  /** Daily target. Without one the row shows the value only (a single meal). */
  target?: number
  /** Going over this target is worth flagging (kcal, sugar, sodium). */
  limit?: boolean
}

/**
 * One card, one row per tracked value, all with the same weight. Used for the
 * day on the home screen (with targets) and for a single meal after a scan
 * (values only), so the two always read the same.
 */
export function NutrientCard({ rows }: { rows: NutrientRow[] }) {
  const theme = useTheme()
  return (
    <View style={[styles.card, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
      {rows.map((r, i) => {
        const hasTarget = r.target !== undefined && r.target > 0
        const pct = hasTarget ? Math.min(1, r.value / (r.target as number)) : 0
        const over = hasTarget && !!r.limit && r.value > (r.target as number)
        const fill = over ? theme.uncertain : r.color
        return (
          <View key={r.key} style={[styles.row, i > 0 && { marginTop: space.lg }]}>
            <View style={styles.line}>
              <View style={styles.label}>
                <Icon name={r.icon} size={18} color={r.color} />
                <Text style={[type.body, { color: theme.text }]}>{r.label}</Text>
              </View>
              <Text style={[type.bodyStrong, { color: over ? theme.uncertain : theme.text }]}>
                {formatInteger(r.value)}
                {hasTarget ? (
                  <Text style={[type.caption, { color: theme.textMuted }]}>
                    {` / ${formatInteger(r.target as number)}`}
                  </Text>
                ) : null}
                <Text style={[type.caption, { color: theme.textMuted }]}>{` ${r.unit}`}</Text>
              </Text>
            </View>
            {hasTarget ? (
              <View style={[styles.track, { backgroundColor: theme.ringTrack }]}>
                <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: fill }]} />
              </View>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { padding: space.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  row: {},
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  track: { height: 6, borderRadius: 3, marginTop: space.sm, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
})
