import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { openNodeDb } from '@nutai/db-adapter/node'
import { AUTO_ACCEPT, resolveByText } from './index.js'

/**
 * Resolver bench on the REAL built database. Skipped unless BENCH_DB is set:
 *
 *   BENCH_DB=apps/mobile/assets/nutrition-v2.db npx vitest run packages/resolver/src/bench.test.ts
 *   (optional) BENCH_OUT=bench.md   also writes the table to a file
 *
 * Question it answers: with the current AUTO_ACCEPT thresholds, how often does the
 * resolver pick a row on its own, and how often is that row wrong? An accepted wrong
 * row is the costly case (a silent bad log); a disambiguation is only a tap.
 *
 * "Correct" is a loose judgement: the row name matches `expect`. Read the printed
 * top names too, the regexes are a screen and not a verdict.
 */

const CASES: Array<{ q: string; expect: RegExp; kind: 'basic' | 'dish' }> = [
  { q: 'jabłko', expect: /jab[łl]k/i, kind: 'basic' },
  { q: 'banan', expect: /banan/i, kind: 'basic' },
  { q: 'chleb żytni', expect: /chleb/i, kind: 'basic' },
  { q: 'bułka pszenna', expect: /bu[łl]k/i, kind: 'basic' },
  { q: 'mleko 2%', expect: /mleko/i, kind: 'basic' },
  { q: 'jogurt naturalny', expect: /jogurt/i, kind: 'basic' },
  { q: 'twaróg półtłusty', expect: /tw[aó]r[oó]g/i, kind: 'basic' },
  { q: 'ser żółty', expect: /ser/i, kind: 'basic' },
  { q: 'jajko gotowane', expect: /jaj/i, kind: 'basic' },
  { q: 'pierś z kurczaka', expect: /kurczak|kurcz|pier[śs]/i, kind: 'basic' },
  { q: 'schab pieczony', expect: /schab/i, kind: 'basic' },
  { q: 'kiełbasa', expect: /kie[łl]basa/i, kind: 'basic' },
  { q: 'szynka', expect: /szynka/i, kind: 'basic' },
  { q: 'ziemniaki gotowane', expect: /ziemni/i, kind: 'basic' },
  { q: 'ryż biały gotowany', expect: /ry[żz]/i, kind: 'basic' },
  { q: 'makaron gotowany', expect: /makaron/i, kind: 'basic' },
  { q: 'płatki owsiane', expect: /p[łl]atki|owsian/i, kind: 'basic' },
  { q: 'masło', expect: /mas[łl]o/i, kind: 'basic' },
  { q: 'pomidor', expect: /pomidor/i, kind: 'basic' },
  { q: 'ogórek', expect: /og[óo]rek/i, kind: 'basic' },
  { q: 'marchew', expect: /marchew/i, kind: 'basic' },
  { q: 'cebula', expect: /cebul/i, kind: 'basic' },
  { q: 'czekolada mleczna', expect: /czekolad/i, kind: 'basic' },
  { q: 'pierogi ruskie', expect: /pierog/i, kind: 'dish' },
  { q: 'kotlet schabowy', expect: /kotlet|schab/i, kind: 'dish' },
  { q: 'bigos', expect: /bigos/i, kind: 'dish' },
  { q: 'zupa pomidorowa', expect: /pomidor|zup/i, kind: 'dish' },
  { q: 'żurek', expect: /[żz]urek/i, kind: 'dish' },
  { q: 'naleśniki', expect: /nale[śs]nik/i, kind: 'dish' },
  { q: 'sernik', expect: /sernik/i, kind: 'dish' },
  { q: 'gołąbki', expect: /go[łl][ąa]bk/i, kind: 'dish' },
  { q: 'kotlet mielony', expect: /kotlet|miel/i, kind: 'dish' },
]

type Verdict = 'auto_ok' | 'auto_wrong' | 'dis_top1' | 'dis_top5' | 'dis_none' | 'miss'

describe.skipIf(!process.env['BENCH_DB'])('resolver bench (set BENCH_DB)', () => {
  it('prints outcomes for the Polish query set', async () => {
    const db = openNodeDb(process.env['BENCH_DB']!, { readonly: true })
    const lines: string[] = []
    const tally: Record<string, Record<Verdict, number>> = {
      basic: { auto_ok: 0, auto_wrong: 0, dis_top1: 0, dis_top5: 0, dis_none: 0, miss: 0 },
      dish: { auto_ok: 0, auto_wrong: 0, dis_top1: 0, dis_top5: 0, dis_none: 0, miss: 0 },
    }

    lines.push(`AUTO_ACCEPT minScore=${AUTO_ACCEPT.minScore} minGap=${AUTO_ACCEPT.minGap}`)
    lines.push('')
    lines.push('| zapytanie | typ | wynik | top1 | gap | top nazwy |')
    lines.push('|---|---|---|---|---|---|')

    for (const c of CASES) {
      const r = await resolveByText(db, {
        canonicalFoodKey: c.q,
        observedBrand: null,
        prepFacet: null,
        modelCategory: null,
        estimatedGrams: 150,
      })
      let verdict: Verdict
      let top1 = ''
      let gap = ''
      let names = ''
      if (r.outcome.kind === 'auto_accept') {
        const m = r.outcome.match
        verdict = c.expect.test(m.name) ? 'auto_ok' : 'auto_wrong'
        top1 = m.score.toFixed(2)
        names = m.name
      } else if (r.outcome.kind === 'disambiguate') {
        const cs = r.outcome.candidates
        verdict = c.expect.test(cs[0]!.name) ? 'dis_top1' : cs.some((x) => c.expect.test(x.name)) ? 'dis_top5' : 'dis_none'
        top1 = cs[0]!.score.toFixed(2)
        gap = cs[1] ? (cs[0]!.score - cs[1].score).toFixed(2) : 'n/a'
        names = cs.map((x) => x.name).join(' / ')
      } else {
        verdict = 'miss'
      }
      tally[c.kind]![verdict]++
      lines.push(`| ${c.q} | ${c.kind} | ${verdict} | ${top1} | ${gap} | ${names.replace(/\|/g, '/')} |`)
    }

    lines.push('')
    for (const kind of ['basic', 'dish'] as const) {
      const t = tally[kind]!
      const n = Object.values(t).reduce((a, b) => a + b, 0)
      lines.push(
        `${kind} (n=${n}): auto_ok ${t.auto_ok}, auto_wrong ${t.auto_wrong}, dis_top1 ${t.dis_top1}, dis_top5 ${t.dis_top5}, dis_none ${t.dis_none}, miss ${t.miss}`,
      )
    }
    const out = lines.join('\n')
    console.log('\n' + out + '\n')
    if (process.env['BENCH_OUT']) writeFileSync(process.env['BENCH_OUT'], out + '\n')
  }, 120_000)
})
