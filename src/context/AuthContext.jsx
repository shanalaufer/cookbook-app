import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [preferences, setPreferences] = useState({ dietary_restrictions: '', gemini_api_key: '' })

  async function loadPreferences(userId) {
    const { data } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single()
    if (data) setPreferences(data)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadPreferences(session.user.id)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      // Preserve object identity across token refreshes — Supabase sends a
      // fresh user object on every auth event, and swapping it re-runs every
      // effect keyed on `user` (e.g. shopping-list init).
      setUser(prev => (prev?.id === nextUser?.id ? prev : nextUser))
      if (nextUser) loadPreferences(nextUser.id)
      else setPreferences({ dietary_restrictions: '', gemini_api_key: '' })
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signUp(email, password) {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) throw error
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  async function updatePreferences(updates) {
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(
        { user_id: user.id, ...updates, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
      .select()
      .single()
    if (error) throw error
    setPreferences(data)
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, preferences, signUp, signIn, signInWithGoogle, signOut, updatePreferences }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- co-locating the hook with its provider is worth losing fast-refresh here
export const useAuth = () => useContext(AuthContext)
