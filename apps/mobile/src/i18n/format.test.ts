import { describe, expect, it } from 'vitest'
import { formatDate, formatDecimal, formatInteger, formatMonthYear, pluralPl, weekdayName } from './format'

describe('formatDecimal', () => {
  it('uses a decimal comma and keeps trailing zeros', () => {
    expect(formatDecimal(80.456)).toBe('80,5')
    expect(formatDecimal(80)).toBe('80,0')
    expect(formatDecimal(0.25, 2)).toBe('0,25')
  })
  it('does not print negative zero', () => {
    expect(formatDecimal(-0.04)).toBe('0,0')
  })
  it('survives non-finite input', () => {
    expect(formatDecimal(NaN)).toBe('–')
  })
})

describe('formatInteger', () => {
  it('groups thousands with a non-breaking space', () => {
    expect(formatInteger(1234567)).toBe('1\u00A0234\u00A0567')
    expect(formatInteger(999)).toBe('999')
    expect(formatInteger(-1500)).toBe('−1\u00A0500')
  })
})

describe('dates', () => {
  it('formats genitive month names', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('5 stycznia')
    expect(formatDate(new Date(2026, 8, 30), { withYear: true })).toBe('30 września 2026')
  })
  it('formats month and year in the nominative', () => {
    expect(formatMonthYear(new Date(2026, 9, 11))).toBe('październik 2026')
  })
  it('names weekdays', () => {
    expect(weekdayName(new Date(2026, 9, 11))).toBe('niedziela')
  })
})

describe('pluralPl', () => {
  const f = (n: number) => pluralPl(n, 'posiłek', 'posiłki', 'posiłków')
  it('handles the three Polish plural classes', () => {
    expect(f(1)).toBe('posiłek')
    expect(f(2)).toBe('posiłki')
    expect(f(4)).toBe('posiłki')
    expect(f(5)).toBe('posiłków')
    expect(f(0)).toBe('posiłków')
  })
  it('treats the teens as "many"', () => {
    expect(f(12)).toBe('posiłków')
    expect(f(14)).toBe('posiłków')
    expect(f(22)).toBe('posiłki')
    expect(f(112)).toBe('posiłków')
  })
})
