import { supabase } from './supabase'

// Data helpers for named shopping lists. Shared by ShoppingListsContext, the
// shopping page, the ingredient checklist, and the AI action executor.

export async function getLists(userId) {
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) console.error('[Lists] getLists failed (has the migration been run?):', error.message)
  return data ?? []
}

// Returns the user's default list, creating "My List" if they have none yet.
export async function ensureDefaultList(userId) {
  const lists = await getLists(userId)
  if (lists.length) return lists.find(l => l.is_default) ?? lists[0]
  const { data } = await supabase
    .from('shopping_lists')
    .insert({ user_id: userId, name: 'My List', is_default: true })
    .select()
    .single()
  return data
}

export async function createList(userId, name) {
  const { data, error } = await supabase
    .from('shopping_lists')
    .insert({ user_id: userId, name: name.trim() })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function renameList(listId, name) {
  const { error } = await supabase
    .from('shopping_lists')
    .update({ name: name.trim() })
    .eq('id', listId)
  if (error) throw error
}

// Creates a new list and copies the source list's items into it (unchecked).
export async function duplicateList(userId, sourceListId, name) {
  const list = await createList(userId, name)
  const { data: items } = await supabase
    .from('shopping_list')
    .select('ingredient,amount,category,recipe_name')
    .eq('list_id', sourceListId)
  if (items?.length) {
    await supabase.from('shopping_list').insert(
      items.map(it => ({ ...it, user_id: userId, list_id: list.id, checked: false }))
    )
  }
  return list
}

// Deletes a list; its items cascade via the FK.
export async function deleteList(listId) {
  const { error } = await supabase.from('shopping_lists').delete().eq('id', listId)
  if (error) throw error
}

// Resolve a list by name (case-insensitive). Used by the AI so "Costco" maps to
// an existing list instead of spawning duplicates. Falls back to fallbackListId
// when name is empty; creates the list when create=true and no match exists.
export async function resolveListByName(userId, name, { create = false, fallbackListId = null } = {}) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return fallbackListId
  const lists = await getLists(userId)
  const match = lists.find(l => l.name.toLowerCase() === trimmed.toLowerCase())
  if (match) return match.id
  if (create) {
    const created = await createList(userId, trimmed)
    return created.id
  }
  return fallbackListId
}
