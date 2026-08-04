import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import RecipeCard from '../components/RecipeCard'
import RecipeFullView from '../components/RecipeFullView'
import AddRecipeModal from '../components/AddRecipeModal'
import EditRecipeModal from '../components/EditRecipeModal'
import { uploadRecipePhotoFile, deleteRecipePhotoByUrl } from '../lib/image'

export default function Cookbook() {
  const { user } = useAuth()
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('recipes')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (error) {
      // Keep prior recipes on screen — a failed load must not masquerade as
      // an empty cookbook.
      console.error('[Cookbook] load failed:', error)
      setLoadError(true)
    } else {
      setLoadError(false)
      setRecipes(data ?? [])
    }
    setLoading(false)
  }, [user.id])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState runs after the await, not synchronously
  useEffect(() => { load() }, [load])

  async function handleDelete(recipe) {
    if (!confirm(`Delete "${recipe.title}"?`)) return
    const { error } = await supabase.from('recipes').delete().eq('id', recipe.id)
    if (error) { alert('Failed to delete: ' + error.message); return }
    setSelected(null)
    load()
  }

  async function handlePhotoUpload(recipe, file) {
    let publicUrl
    try {
      publicUrl = await uploadRecipePhotoFile(file, user.id)
    } catch (e) {
      alert('Photo upload failed: ' + e.message)
      return
    }
    const { error: dbError } = await supabase
      .from('recipes')
      .update({ source_image: publicUrl })
      .eq('id', recipe.id)
    if (dbError) { alert('Failed to save photo: ' + dbError.message); return }
    const updated = { ...recipe, source_image: publicUrl }
    setSelected(updated)
    setRecipes(prev => prev.map(r => r.id === recipe.id ? updated : r))
  }

  async function handlePhotoDelete(recipe) {
    if (!confirm('Remove this photo?')) return
    // DB first, storage second: if the row update fails we haven't destroyed
    // the file, so the recipe never points at a deleted image.
    const { error } = await supabase
      .from('recipes')
      .update({ source_image: null })
      .eq('id', recipe.id)
    if (error) { alert('Failed to remove photo: ' + error.message); return }
    deleteRecipePhotoByUrl(recipe.source_image).catch(err =>
      console.error('[Cookbook] storage cleanup failed:', err)
    )
    const updated = { ...recipe, source_image: null }
    setSelected(updated)
    setRecipes(prev => prev.map(r => r.id === recipe.id ? updated : r))
  }

  const filtered = recipes.filter(r =>
    r.title.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingRight: 52 }}>
        <div>
          <h1>Cookbook</h1>
          <p>{recipes.length} recipe{recipes.length !== 1 ? 's' : ''} saved</p>
        </div>
        <button className="fab" onClick={() => setShowAdd(true)}>+</button>
      </div>

      {recipes.length > 4 && (
        <input
          className="input-field"
          placeholder="Search recipes…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: 16 }}
        />
      )}

      {loading && (
        <div className="loading-state">
          <div className="spinner" />
        </div>
      )}

      {!loading && loadError && (
        <div className="empty-state">
          <div className="empty-icon">⚠️</div>
          <p>Couldn't load your recipes</p>
          <p className="hint">Check your connection, then try again.</p>
          <button className="btn-secondary" onClick={load} style={{ marginTop: 12 }}>Retry</button>
        </div>
      )}

      {!loading && !loadError && recipes.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📚</div>
          <p>Your cookbook is empty</p>
          <p className="hint">Tap + to add a recipe, or save one from the AI chat</p>
        </div>
      )}

      <div className="recipe-grid">
        {filtered.map(recipe => (
          <RecipeCard key={recipe.id} recipe={recipe} onClick={() => setSelected(recipe)} />
        ))}
      </div>

      {selected && !editing && (
        <RecipeFullView
          recipe={selected}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(selected)}
          onDelete={() => handleDelete(selected)}
          onPhotoChange={file => handlePhotoUpload(selected, file)}
          onPhotoDelete={selected.source_image ? () => handlePhotoDelete(selected) : undefined}
          showDeleteButton
        />
      )}

      {editing && (
        <EditRecipeModal
          recipe={editing}
          onClose={() => setEditing(null)}
          onSaved={updated => {
            setEditing(null)
            setSelected(updated)
            setRecipes(prev => prev.map(r => r.id === updated.id ? updated : r))
          }}
        />
      )}

      {showAdd && (
        <AddRecipeModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
        />
      )}
    </div>
  )
}
