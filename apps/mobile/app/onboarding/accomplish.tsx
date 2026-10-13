import { OptionScreen } from '../../src/components/onboarding/OptionScreen'

export default function AccomplishScreen() {
  return (
    <OptionScreen
      step="accomplish"
      field="accomplish"
      title="Co chcesz osiągnąć?"
      // Consumer: todayEmphasisFor(). Decides what the Today screen leads with.
      subtitle="To decyduje, co ekran Dziś pokazuje na początku."
      options={[
        { value: 'healthier', label: 'Jeść i żyć zdrowiej', glyph: 'apple' },
        { value: 'energy', label: 'Mieć więcej energii i lepszy nastrój', glyph: 'sun' },
        { value: 'motivated', label: 'Utrzymać motywację i systematyczność', glyph: 'muscle' },
        { value: 'body_image', label: 'Lepiej czuć się ze swoim ciałem', glyph: 'lotus' },
      ]}
      scroll
    />
  )
}
