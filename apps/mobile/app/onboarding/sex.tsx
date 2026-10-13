import { OptionScreen } from '../../src/components/onboarding/OptionScreen'

export default function SexScreen() {
  return (
    <OptionScreen
      step="sex"
      field="sex"
      title="Wybierz płeć"
      subtitle="Używamy tego wyłącznie w równaniu BMR, które ustala Twój cel kaloryczny."
      options={[
        { value: 'male', label: 'Mężczyzna', glyph: 'male' },
        { value: 'female', label: 'Kobieta', glyph: 'female' },
        { value: 'unspecified', label: 'Inna', glyph: 'nonbinary' },
      ]}
    />
  )
}
