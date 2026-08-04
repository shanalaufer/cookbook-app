import { supabase } from './supabase'
import { categorizeIngredients } from './ai'
import { normalizeCategory } from './categories'
import { ingredientKey } from './quantity'

// Per-user category assignment that layers remembered overrides on top of the AI
// categorizer: overrides win, and only the still-unknown names are sent to the AI
// (cheaper, and it respects the user's past corrections).

// One shared normalization for both storing and looking up overrides —
// "tomatoes", "Tomato, diced", and "2 ripe tomatoes" must all hit the same row.
const key = name => ingredientKey(name)

export async function getCategoryOverrides(userId, names) {
  const lowered = [...new Set(names.map(key))]
  if (!lowered.length) return {}
  const { data } = await supabase
    .from('ingredient_categories')
    .select('ingredient,category')
    .eq('user_id', userId)
    .in('ingredient', lowered)
  const map = {}
  for (const row of data ?? []) map[row.ingredient] = normalizeCategory(row.category)
  return map
}

// Returns { <original name>: Category } for every input name.
export async function categorizeWithOverrides(userId, names) {
  const unique = [...new Set(names)]
  const overrides = await getCategoryOverrides(userId, unique)

  const unknown = unique.filter(n => !overrides[key(n)])
  let aiCats = {}
  if (unknown.length) {
    try { aiCats = await categorizeIngredients(unknown) } catch { /* fall back to Other */ }
  }

  const result = {}
  for (const name of unique) {
    result[name] = overrides[key(name)]
      ?? normalizeCategory(aiCats[name] ?? aiCats[key(name)])
  }
  return result
}

// Remember a user's category choice so future lists reuse it.
export async function rememberCategory(userId, ingredient, category) {
  await supabase
    .from('ingredient_categories')
    .upsert(
      { user_id: userId, ingredient: key(ingredient), category, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,ingredient' }
    )
}
