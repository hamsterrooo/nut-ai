/**
 * Polish number, date and plural formatting.
 *
 * Deliberately NOT built on Intl: Hermes' Intl coverage differs between
 * platforms and OS versions, and a settings screen that prints "80.5 kg" on one
 * phone and "80,5 kg" on another is worse than either. These are plain string
 * functions, so they behave identically everywhere and run under bare Node in
 * the test suite.
 */

/** 80.456 -> "80,5". Trailing zeros are kept: "80,0" is a measurement, "80" is not. */
export function formatDecimal(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '–'
  const fixed = n.toFixed(digits)
  // toFixed(0) of -0.4 gives "-0"; show "0".
  const normalized = /^-0(\.0+)?$/.test(fixed) ? fixed.slice(1) : fixed
  return normalized.replace('.', ',')
}

/** 1234567 -> "1 234 567" (non-breaking spaces, as Polish typography uses). */
export function formatInteger(n: number): string {
  if (!Number.isFinite(n)) return '–'
  const rounded = Math.round(n)
  const sign = rounded < 0 ? '−' : ''
  const digits = String(Math.abs(rounded))
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')
}

const MONTHS_GENITIVE = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
] as const

const MONTHS_NOMINATIVE = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
] as const

const WEEKDAYS = [
  'niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota',
] as const

/** "12 stycznia" (or "12 stycznia 2027" with `withYear`). */
export function formatDate(d: Date, opts: { withYear?: boolean } = {}): string {
  const base = `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`
  return opts.withYear ? `${base} ${d.getFullYear()}` : base
}

/** "styczeń 2027". */
export function formatMonthYear(d: Date): string {
  return `${MONTHS_NOMINATIVE[d.getMonth()]} ${d.getFullYear()}`
}

/** "wtorek". */
export function weekdayName(d: Date): string {
  return WEEKDAYS[d.getDay()]!
}

/**
 * Polish has three plural forms: 1 posiłek, 2-4 posiłki, 5+ posiłków.
 * (Teens 12-14 and everything ending 0, 1 or 5-9 take the "many" form.)
 */
export function pluralPl(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n))
  if (abs === 1) return one
  const last = abs % 10
  const lastTwo = abs % 100
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few
  return many
}
