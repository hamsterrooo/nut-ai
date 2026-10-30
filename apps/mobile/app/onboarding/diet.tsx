import { OptionScreen } from '../../src/components/onboarding/OptionScreen'

export default function DietScreen() {
  return (
    <OptionScreen
      step="diet"
      field="dietStyle"
      title="Czy stosujesz określoną dietę?"
      options={[
        { value: 'balanced', label: 'Zbilansowana', glyph: 'scaleBalance' },
        { value: 'whole_food', label: 'Nieprzetworzona żywność', glyph: 'bowl' },
        { value: 'mediterranean', label: 'Śródziemnomorska', glyph: 'leaf' },
        { value: 'flexitarian', label: 'Fleksitariańska', glyph: 'meat' },
        { value: 'pescatarian', label: 'Peskatariańska', glyph: 'fish' },
        { value: 'vegetarian', label: 'Wegetariańska', glyph: 'sprout' },
        { value: 'vegan', label: 'Wegańska', glyph: 'sprout' },
      ]}
      scroll
    />
  )
}
