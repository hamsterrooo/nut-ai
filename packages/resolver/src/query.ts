/**
 * Query construction for FTS5.
 *
 * SPEC-accuracy-engine.md §5.4. Two things this module deliberately does NOT do,
 * because FTS5 already does them better:
 *
 *   PLURALS AND INFLECTION -> the porter tokenizer, not app code. It is applied
 *   identically to indexed content and to the query, so over-stemming
 *   (sauce -> sauc) is irrelevant: it only has to be internally consistent, which
 *   it is by construction.
 *
 *   WORD ORDER -> needs no handling at all. FTS5 ANDs bareword tokens regardless
 *   of order, so `chicken breast grilled` matches "Chicken, broilers or fryers,
 *   breast, meat only, cooked, grilled". USDA's comma-reversed attribute-heavy
 *   naming works naturally with unordered token matching, and no comma-permutation
 *   logic is needed anywhere.
 *
 * This is the concrete reason the system prompt insists on generic-noun-first
 * USDA-style keys: the query and the corpus share an idiom, and BM25 rewards that.
 */

/** FTS5 syntax characters that must never reach the matcher unescaped. */
const FTS_SPECIAL = /["()*:^-]/g

/**
 * Turn a canonical food key into an FTS5 MATCH expression.
 *
 * Every token is double-quoted, which makes it a literal bareword rather than a
 * potential operator. Without this, a food key containing `OR` or `NOT` — or a
 * user typing `chicken - breast` in the search box — silently becomes a different
 * query, and a stray unbalanced quote is a runtime error rather than zero results.
 */
export function toMatchExpression(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .replace(FTS_SPECIAL, ' ')
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  if (tokens.length === 0) return null
  return tokens.map((t) => `"${t}"`).join(' ')
}

/**
 * A progressively broader ladder of MATCH expressions.
 *
 * The full AND query is precise but brittle: one token absent from the corpus
 * returns zero rows even when the rest matched perfectly. Rather than jumping
 * straight to the miss path, drop the least-informative tokens and retry.
 * Recorded per attempt so the zero-hit rate can be instrumented honestly — §5.5
 * sets a concrete upgrade trigger at ~5% zero-hit, which only means something if
 * the measurement counts real misses rather than first-attempt misses.
 */
export function matchLadder(canonicalFoodKey: string): string[] {
  const tokens = canonicalFoodKey
    .toLowerCase()
    .replace(FTS_SPECIAL, ' ')
    .split(/[\s,]+/)
    .filter(Boolean)

  if (tokens.length === 0) return []

  const ladder: string[] = []
  const all = tokens.map((t) => `"${t}"`).join(' ')
  ladder.push(all)

  // Drop trailing modifiers first — in USDA-style keys the head noun leads, so
  // "chicken breast, grilled" degrades to "chicken breast" rather than "grilled".
  for (let keep = tokens.length - 1; keep >= 1; keep--) {
    const expr = tokens.slice(0, keep).map((t) => `"${t}"`).join(' ')
    if (!ladder.includes(expr)) ladder.push(expr)
  }

  // Last resort: OR the tokens so a partial match still surfaces candidates for
  // the disambiguation sheet.
  if (tokens.length > 1) {
    ladder.push(tokens.map((t) => `"${t}"`).join(' OR '))
  }

  return ladder
}
