import { OptionScreen } from '../../src/components/onboarding/OptionScreen'

export default function WorkoutsScreen() {
  return (
    <OptionScreen
      step="workouts"
      field="workoutsPerWeek"
      title="Ile razy w tygodniu ćwiczysz?"
      subtitle="To ustawia mnożnik aktywności w Twoim celu kalorycznym."
      options={[
        { value: '0-2', label: '0-2', sublabel: 'Treningi od czasu do czasu', glyph: 'dot1' },
        { value: '3-5', label: '3-5', sublabel: 'Kilka treningów w tygodniu', glyph: 'dot3' },
        { value: '6+', label: '6+', sublabel: 'Zaangażowany sportowiec', glyph: 'dot6' },
      ]}
    />
  )
}
