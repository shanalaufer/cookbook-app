// Quantity-aware amount merging for shopping items. The guiding rule: only
// combine amounts when it's unambiguously safe (same unit, both numeric).
// When in doubt, list amounts separately rather than guess.

const UNICODE_FRACTIONS = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

// Map many spellings to one canonical unit. Empty string = unitless count.
const UNIT_SYNONYMS = {
  cup: 'cup', cups: 'cup', c: 'cup',
  tbsp: 'tbsp', tbsps: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  qt: 'qt', quart: 'qt', quarts: 'qt',
  pt: 'pt', pint: 'pt', pints: 'pt',
  gallon: 'gallon', gallons: 'gallon',
  clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can',
  jar: 'jar', jars: 'jar',
  package: 'package', packages: 'package', pkg: 'package', pkgs: 'package',
  head: 'head', heads: 'head',
  bunch: 'bunch', bunches: 'bunch',
  slice: 'slice', slices: 'slice',
  stalk: 'stalk', stalks: 'stalk',
  sprig: 'sprig', sprigs: 'sprig',
}

const PLURALIZE_UNITS = new Set([
  'cup', 'oz', 'lb', 'clove', 'can', 'jar', 'package', 'head', 'bunch',
  'slice', 'stalk', 'sprig', 'quart', 'pint', 'gallon',
])

function parseNumber(str) {
  let s = str.trim()
  for (const [g, v] of Object.entries(UNICODE_FRACTIONS)) {
    if (s.includes(g)) s = s.replace(g, (s.match(/\d\s*$/) ? ' ' : '') + v)
  }
  s = s.trim()
  // mixed number "1 1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  // simple fraction "1/2"
  const frac = s.match(/^(\d+)\/(\d+)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  // decimal or integer
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  return null
}

// Splits a full ingredient line: "2 cups flour" → { amount: "2 cups", name: "flour" }
// Strings with no leading quantity → { amount: "", name: <original> }
export function parseIngredient(raw) {
  const str = (raw ?? '').trim()
  const m = str.match(
    /^([\d¼½¾⅓⅔⅛⅜⅝⅞][\d\s./\-–]*(?:\([^)]*\)\s*)?(?:cups?|tbsps?|tsps?|tablespoons?|teaspoons?|fl\.?\s*oz|fluid\s+oz|ounces?|oz|pounds?|lbs?|lb|grams?|g|kg|ml|liters?|l|quarts?|qt|pints?|pt|gallons?|cans?|jars?|pkgs?|packages?|cloves?|heads?|bunches?|slices?|pieces?|stalks?|sprigs?|large|medium|small|whole)?)\s+(.+)/i
  )
  if (m && m[2].trim()) return { amount: m[1].trim(), name: m[2].trim() }
  return { amount: '', name: str }
}

// "2 cups" → { qty: 2, unit: 'cup', raw: '2 cups' }
// unparseable / ranges → { qty: null, unit: null, raw }
export function parseAmount(raw) {
  const text = (raw ?? '').trim()
  if (!text) return { qty: null, unit: null, raw: '' }
  // Ranges are never safe to merge
  if (/\d\s*[-–]\s*\d/.test(text)) return { qty: null, unit: null, raw: text }

  // Split leading quantity token(s) from a trailing unit word
  const m = text.match(/^([\d./¼½¾⅓⅔⅛⅜⅝⅞\s]+)\s*([a-zA-Z]+)?\.?$/)
  if (!m) return { qty: null, unit: null, raw: text }
  const qty = parseNumber(m[1])
  if (qty === null) return { qty: null, unit: null, raw: text }
  const unitWord = (m[2] ?? '').toLowerCase()
  if (m[2] && !(unitWord in UNIT_SYNONYMS)) {
    // unrecognized unit → don't risk merging
    return { qty: null, unit: null, raw: text }
  }
  return { qty, unit: UNIT_SYNONYMS[unitWord] ?? '', raw: text }
}

function formatQty(n) {
  const whole = Math.floor(n)
  const frac = n - whole
  const map = { 0.25: '¼', 0.5: '½', 0.75: '¾', 0.125: '⅛', 0.375: '⅜', 0.625: '⅝', 0.875: '⅞' }
  let fracStr = ''
  for (const [v, g] of Object.entries(map)) {
    if (Math.abs(frac - Number(v)) < 0.01) { fracStr = g; break }
  }
  if (Math.abs(frac - 1 / 3) < 0.01) fracStr = '⅓'
  if (Math.abs(frac - 2 / 3) < 0.01) fracStr = '⅔'
  if (fracStr) return whole ? `${whole}${fracStr}` : fracStr
  return Number(n.toFixed(2)).toString()
}

function formatUnit(unit, qty) {
  if (!unit) return ''
  if (qty > 1 && PLURALIZE_UNITS.has(unit)) {
    if (unit === 'bunch') return 'bunches'
    return unit + 's'
  }
  return unit
}

// Merge a list of amount strings into one display string.
// Same unit + all numeric → summed ("2 cups"). Otherwise the distinct amounts
// are listed ("1 cup + 2 tbsp", "2 cloves + to taste"). Empty → ''.
export function mergeAmounts(amounts) {
  const parsed = (amounts ?? []).map(a => (a ?? '').trim()).filter(Boolean)
  if (!parsed.length) return ''

  const buckets = new Map()     // canonical unit → summed qty (or null if unsafe)
  const rawByUnit = new Map()   // canonical unit → [raw strings]
  const loose = []              // unparseable raws, kept verbatim (deduped)

  for (const raw of parsed) {
    const { qty, unit } = parseAmount(raw)
    if (qty === null) {
      if (!loose.includes(raw)) loose.push(raw)
      continue
    }
    if (!rawByUnit.has(unit)) rawByUnit.set(unit, [])
    rawByUnit.get(unit).push(raw)
    buckets.set(unit, (buckets.get(unit) ?? 0) + qty)
  }

  const parts = []
  for (const [unit, sum] of buckets) {
    parts.push(`${formatQty(sum)}${unit ? ' ' + formatUnit(unit, sum) : ''}`.trim())
  }
  parts.push(...loose)
  return parts.join(' + ')
}
