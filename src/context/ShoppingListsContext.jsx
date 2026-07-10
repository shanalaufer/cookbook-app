import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from '../lib/supabase'
import { getLists, ensureDefaultList } from '../lib/lists'

// Single source of truth for the user's shopping lists and which one is active.
// Shared app-wide because items are added to a list from several disconnected
// places: the shopping page, the ingredient checklist (opened from Cookbook and
// AIChat via RecipeFullView), the meal planner, and the AI action executor.
//
// The active-list selection is persisted in user_preferences.active_list_id so
// it follows the user across devices (everything else lives in Supabase too).

const ShoppingListsContext = createContext(null)

export function ShoppingListsProvider({ children }) {
  const { user, updatePreferences } = useAuth()
  const [lists, setLists] = useState([])
  const [activeListId, setActiveListId] = useState(null)
  const [ready, setReady] = useState(false)

  const refreshLists = useCallback(async () => {
    if (!user) return []
    const next = await getLists(user.id)
    setLists(next)
    return next
  }, [user])

  // Load lists (creating a default if needed) and the stored active-list pointer
  // together, so the restored selection is authoritative and race-free.
  useEffect(() => {
    let cancelled = false
    async function init() {
      if (!user) { setLists([]); setActiveListId(null); setReady(false); return }
      let next = await getLists(user.id)
      if (!next.length) {
        await ensureDefaultList(user.id)
        next = await getLists(user.id)
      }
      const { data: pref } = await supabase
        .from('user_preferences')
        .select('active_list_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (cancelled) return
      setLists(next)
      const stored = pref?.active_list_id
      const valid = next.find(l => l.id === stored)
      setActiveListId(valid?.id ?? (next.find(l => l.is_default) ?? next[0])?.id ?? null)
      setReady(true)
    }
    init()
    return () => { cancelled = true }
  }, [user])

  const setActiveList = useCallback((listId) => {
    setActiveListId(listId)
    // Persist to Supabase so the selection syncs across devices
    updatePreferences({ active_list_id: listId }).catch(err =>
      console.error('[Lists] failed to save active list:', err)
    )
  }, [updatePreferences])

  return (
    <ShoppingListsContext.Provider
      value={{ lists, activeListId, setActiveList, refreshLists, ready }}
    >
      {children}
    </ShoppingListsContext.Provider>
  )
}

export const useShoppingLists = () => useContext(ShoppingListsContext)
