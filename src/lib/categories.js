// Single source of truth for shopping categories. Imported by ShoppingList,
// IngredientChecklist, AIChat, and the Groq categorizer so they never drift.

export const CATEGORY_ORDER = [
  'Protein',
  'Leafy Greens',
  'Vegetables',
  'Fruit',
  'Fresh Herbs',
  'Healthy Fats',
  'Refrigerated',
  'Pantry',
  'Spices & Seasonings',
  'Frozen',
  'Supplements',
  'Other',
]

export const CATEGORY_ICONS = {
  'Protein':             '🥩',
  'Leafy Greens':        '🥬',
  'Vegetables':          '🥒',
  'Fruit':               '🍎',
  'Fresh Herbs':         '🌿',
  'Healthy Fats':        '🥜',
  'Refrigerated':        '🥛',
  'Pantry':              '🥫',
  'Spices & Seasonings': '🧂',
  'Frozen':              '🧊',
  'Supplements':         '💊',
  'Other':               '📦',
}

export const CATEGORY_SET = new Set(CATEGORY_ORDER)

// Coerce any unknown/misspelled category (e.g. a model typo or a legacy label)
// to 'Other' so it always lands in a renderable bucket.
export function normalizeCategory(category) {
  return CATEGORY_SET.has(category) ? category : 'Other'
}

// Order the categories present in a list for section rendering. Known categories
// keep the canonical order; any unexpected leftover is appended before 'Other'
// so items are never silently dropped from the page.
export function sortCategories(presentKeys) {
  const present = new Set(presentKeys)
  const known = CATEGORY_ORDER.filter(c => present.has(c) && c !== 'Other')
  const unknown = [...present].filter(c => !CATEGORY_SET.has(c))
  const tail = present.has('Other') ? ['Other'] : []
  return [...known, ...unknown, ...tail]
}
