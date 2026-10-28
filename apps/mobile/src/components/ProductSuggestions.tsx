import * as Haptics from 'expo-haptics'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { IngredientRow } from '@nutai/core-schema'
import { resolveByText, type ScoredCandidate } from '@nutai/resolver'
import { resolveSelection } from '../data/food-search-select'
import { openNutritionDb } from '../db/expo-adapter'
import { displayNameWithBrand } from '../scan/barcode-lookup'
import { replaceRowFood } from '../scan/store'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, type } from '../theme/tokens'

/**
 * "Maybe it is this": for a row the AI named from a photo, offer up to three
 * products from the local database (brands first). One tap swaps in that
 * product's real values and keeps the grams. Entirely local, no model call.
 */
/** Home-cooked dishes have no shop-bought look-alike worth suggesting. */
const DISH = /(zup|krem|gulasz|bigos|curry|risotto|lasagn|bulion|rosół|sałat|pierogi|naleśnik)/i

export function ProductSuggestions({ row }: { row: IngredientRow }) {
  const theme = useTheme()
  const [options, setOptions] = useState<ScoredCandidate[]>([])

  const skip = DISH.test(row.displayName)

  useEffect(() => {
    if (skip) return
    let alive = true
    void (async () => {
      try {
        const db = await openNutritionDb()
        const r = await resolveByText(db, {
          canonicalFoodKey: row.displayName,
          observedBrand: null,
          prepFacet: null,
          modelCategory: null,
          estimatedGrams: row.grams,
        })
        const found =
          r.outcome.kind === 'auto_accept'
            ? [r.outcome.match]
            : r.outcome.kind === 'disambiguate'
              ? r.outcome.candidates
              : []
        const list = found
          .filter((c) => c.foodId !== row.sourceFoodId)
          .sort((a, b) => Number(!!b.brand) - Number(!!a.brand))
          .slice(0, 3)
        if (alive) setOptions(list)
      } catch {
        if (alive) setOptions([])
      }
    })()
    return () => {
      alive = false
    }
    // Only the name decides suggestions; grams edits must not re-run the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.displayName, row.sourceFoodId, skip])

  if (skip || options.length === 0) return null

  async function pick(c: ScoredCandidate) {
    void Haptics.selectionAsync()
    const db = await openNutritionDb()
    const sel = await resolveSelection(db, c, row.grams)
    replaceRowFood(row.id, {
      foodId: sel.foodId,
      displayName: displayNameWithBrand(c.brand ?? null, c.name),
      nutrientSnapshot: sel.nutrientSnapshot,
    })
  }

  return (
    <View style={styles.wrap}>
      <Text style={[type.micro, { color: theme.textMuted }]}>Może to:</Text>
      <View style={styles.chips}>
        {options.map((c) => (
          <Pressable
            key={c.foodId}
            accessibilityRole="button"
            onPress={() => void pick(c)}
            style={({ pressed }) => [styles.chip, { borderColor: theme.border, opacity: pressed ? 0.6 : 1 }]}
          >
            <Text numberOfLines={1} style={[type.caption, { color: theme.text }]}>
              {displayNameWithBrand(c.brand ?? null, c.name)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: space.md, gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    maxWidth: '100%',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
})
