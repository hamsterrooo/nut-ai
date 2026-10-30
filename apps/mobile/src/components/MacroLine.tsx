import { StyleSheet, Text, View } from 'react-native'
import { formatDecimal } from '../i18n/format'
import { useTheme } from '../theme/ThemeProvider'
import { space, type } from '../theme/tokens'
import { Icon } from './Icon'

/**
 * The short nutrient line under a meal or an ingredient: an optional lead text
 * (time, kcal), then carbs, protein and fat as a coloured icon plus grams.
 * No letter labels: the colour and the icon carry the meaning.
 */
export function MacroLine({
  lead,
  carbs,
  protein,
  fat,
  decimals = 0,
}: {
  lead?: string
  carbs: number
  protein: number
  fat: number
  decimals?: number
}) {
  const theme = useTheme()
  const items = [
    { icon: 'carbs' as const, v: carbs, c: theme.carbs },
    { icon: 'protein' as const, v: protein, c: theme.protein },
    { icon: 'fat' as const, v: fat, c: theme.fat },
  ]
  return (
    <View style={styles.row}>
      {lead ? <Text style={[type.caption, { color: theme.textMuted }]}>{lead}</Text> : null}
      {items.map((m) => (
        <View key={m.icon} style={styles.item}>
          <Icon name={m.icon} size={13} color={m.c} />
          <Text style={[type.caption, { color: m.c, fontWeight: '600' }]}>
            {formatDecimal(m.v, decimals)} g
          </Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: 2, marginTop: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 3 },
})
