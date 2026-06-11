import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { generateRecipeIdeas } from '../lib/ai'
import { supabase } from '../lib/supabase'
import RecipeCard from '../components/RecipeCard'
import RecipeFullView from '../components/RecipeFullView'

export default function Discover() {
  const { user, preferences } = useAuth()
  const [query, setQuery] = useState('')
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [savedId, setSavedId] = useState(null)

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError('')
    setSavedId(null)
    try {
      const results = await generateRecipeIdeas(query, preferences.dietary_restrictions)
      setRecipes(results.map(r => ({ ...r, source_type: 'ai', ingredients: r.ingredients ?? [] })))
    } catch {
      setError('Failed to generate recipes — please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(recipe) {
    const { data, error: err } = await supabase
      .from('recipes')
      .insert({
        user_id: user.id,
        title: recipe.title,
        description: recipe.description ?? '',
        ingredients: recipe.ingredients ?? [],
        instructions: recipe.instructions ?? '',
        source_type: 'ai',
      })
      .select()
      .single()
    if (!err) {
      setSavedId(recipe.title)
      setSelected(null)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Discover</h1>
        <p>Tell me what you're craving</p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {savedId && <div className="success-banner">✓ "{savedId}" saved to your Cookbook!</div>}

      {!loading && recipes.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🍽️</div>
          <p>Ask me for recipe ideas</p>
          <p className="hint">Try "quick weeknight pasta" or "healthy chicken bowls"</p>
        </div>
      )}

      {loading && (
        <div className="loading-state">
          <div className="spinner" />
          <p>Generating recipes…</p>
        </div>
      )}

      <div className="recipe-grid" style={{ paddingBottom: 120 }}>
        {recipes.map((recipe, i) => (
          <RecipeCard key={i} recipe={recipe} onClick={() => { setSelected(recipe); setSavedId(null) }} />
        ))}
      </div>

      <form className="search-bar" onSubmit={handleSearch}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="What would you like to cook?"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !query.trim()}>→</button>
      </form>

      {selected && (
        <RecipeFullView
          recipe={selected}
          onClose={() => setSelected(null)}
          onSave={() => handleSave(selected)}
          showSaveButton
        />
      )}
    </div>
  )
}
