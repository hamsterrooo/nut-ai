import { OptionScreen } from '../../src/components/onboarding/OptionScreen'

export default function BlockerScreen() {
  return (
    <OptionScreen
      step="blocker"
      field="blocker"
      title="Co powstrzymuje Cię przed osiągnięciem celów?"
      // Consumer: featureDefaultsFor(). This answer decides which retention
      // surfaces are ON by default, so it changes the app you get rather than
      // just being collected.
      subtitle="Włączymy te części aplikacji, które w tym pomagają, a resztę zostawimy wyłączoną."
      options={[
        { value: 'consistency', label: 'Brak systematyczności', glyph: 'bars' },
        { value: 'eating_habits', label: 'Niezdrowe nawyki żywieniowe', glyph: 'burger' },
        { value: 'support', label: 'Brak wsparcia', glyph: 'handshake' },
        { value: 'busy', label: 'Napięty grafik', glyph: 'calendar' },
        { value: 'meal_inspiration', label: 'Brak pomysłów na posiłki', glyph: 'apple' },
      ]}
      scroll
    />
  )
}
