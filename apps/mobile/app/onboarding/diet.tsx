import { OptionScreen } from '../../src/components/onboarding/OptionScreen'

export default function DietScreen() {
  return (
    <OptionScreen
      step="diet"
      field="dietStyle"
      title="Czy stosujesz określoną dietę?"
      // The most functional answer in the whole flow: it biases food resolution
      // and changes the assumption-filler defaults, so a vegan's scan stops
      // resolving to beef and "what kind of milk?" defaults to oat.
      subtitle="Używamy tego do ustawiania kolejności dopasowań produktów i rozsądnych wartości domyślnych, gdy skan jest niepewny."
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
