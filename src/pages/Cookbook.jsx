import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import RecipeCard from '../components/RecipeCard'
import RecipeFullView from '../components/RecipeFullView'
import AddRecipeModal from '../components/AddRecipeModal'
import EditRecipeModal from '../components/EditRecipeModal'

export default function Cookbook() {
  const { user } = useAuth()
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('recipes')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    setRecipes(data ?? [])
    setLoading(false)
  }, [user.id])

  useEffect(() => { load() }, [load])

  async function handleDelete(recipe) {
    if (!confirm(`Delete "${recipe.title}"?`)) return
    await supabase.from('recipes').delete().eq('id', recipe.id)
    setSelected(null)
    load()
  }

  async function handlePhotoUpload(recipe, file) {
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${user.id}/${recipe.id}-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('recipe-photos')
      .upload(path, file, { upsert: true })
    if (uploadError) { alert('Photo upload failed: ' + uploadError.message); return }
    const { data: { publicUrl } } = supabase.storage.from('recipe-photos').getPublicUrl(path)
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
    // Extract the storage path from the public URL (everything after /recipe-photos/)
    const url = recipe.source_image
    const marker = '/recipe-photos/'
    const storagePath = url.includes(marker) ? url.split(marker)[1].split('?')[0] : null
    if (storagePath) {
      await supabase.storage.from('recipe-photos').remove([storagePath])
    }
    const { error } = await supabase
      .from('recipes')
      .update({ source_image: null })
      .eq('id', recipe.id)
    if (error) { alert('Failed to remove photo: ' + error.message); return }
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

      {!loading && recipes.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📚</div>
          <p>Your cookbook is empty</p>
          <p className="hint">Save recipes from Discover, or tap + to add one</p>
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
