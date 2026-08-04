import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { uploadRecipePhotoFile, deleteRecipePhotoByUrl } from '../lib/image'

export default function EditRecipeModal({ recipe, onClose, onSaved }) {
  const { user } = useAuth()
  const [title, setTitle] = useState(recipe.title)
  const [description, setDescription] = useState(recipe.description ?? '')
  const [ingredients, setIngredients] = useState(recipe.ingredients ?? [])
  const [instructions, setInstructions] = useState(recipe.instructions ?? '')
  const [sourceImage, setSourceImage] = useState(recipe.source_image ?? null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)
  // Photos uploaded this session but not yet committed — cleaned up on save/cancel
  const sessionUploadsRef = useRef([])
  const originalImage = recipe.source_image ?? null

  function updateIngredient(i, value) {
    setIngredients(prev => prev.map((ing, idx) => idx === i ? value : ing))
  }

  function removeIngredient(i) {
    setIngredients(prev => prev.filter((_, idx) => idx !== i))
  }

  function addIngredient() {
    setIngredients(prev => [...prev, ''])
  }

  // Photo changes are staged locally and only persisted on "Save Changes".
  // The file still uploads to Storage now (needed to get a URL), but the
  // recipe's source_image isn't repointed until save; Cancel reverts.
  async function handlePhotoFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    setError('')
    try {
      const publicUrl = await uploadRecipePhotoFile(file, user.id)
      sessionUploadsRef.current.push(publicUrl)
      setSourceImage(publicUrl)
    } catch (e2) {
      setError('Photo upload failed: ' + e2.message)
    } finally {
      setPhotoBusy(false)
    }
  }

  function handlePhotoRemove() {
    // Stage removal only — the original stays in Storage until save commits it
    setSourceImage(null)
  }

  // Delete any session uploads we won't keep (keepUrl is the committed one, if any)
  async function cleanupSessionUploads(keepUrl) {
    for (const url of sessionUploadsRef.current) {
      if (url !== keepUrl) await deleteRecipePhotoByUrl(url)
    }
    sessionUploadsRef.current = []
  }

  const dirty =
    title !== recipe.title ||
    description !== (recipe.description ?? '') ||
    instructions !== (recipe.instructions ?? '') ||
    sourceImage !== (recipe.source_image ?? null) ||
    JSON.stringify(ingredients) !== JSON.stringify(recipe.ingredients ?? [])

  // Cancel: confirm if there are unsaved edits, close immediately, then discard
  // session photo uploads in the background (no network wait before dismissal).
  function handleCancel() {
    if (dirty && !confirm('Discard your changes?')) return
    onClose()
    cleanupSessionUploads(null).catch(err =>
      console.error('[Edit] photo cleanup failed:', err)
    )
  }

  async function handleSave() {
    if (!title.trim()) { setError('Title is required.'); return }
    const cleanIngredients = ingredients.map(i => i.trim()).filter(Boolean)
    setSaving(true)
    setError('')
    try {
      const { error: err } = await supabase
        .from('recipes')
        .update({
          title: title.trim(),
          description: description.trim(),
          ingredients: cleanIngredients,
          instructions: instructions.trim(),
          source_image: sourceImage,
        })
        .eq('id', recipe.id)
      if (err) throw err
      // Drop superseded session uploads, and the original if we replaced/removed it
      await cleanupSessionUploads(sourceImage)
      if (originalImage && originalImage !== sourceImage) await deleteRecipePhotoByUrl(originalImage)
      onSaved({ ...recipe, title: title.trim(), description: description.trim(), ingredients: cleanIngredients, instructions: instructions.trim(), source_image: sourceImage })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={handleCancel}>✕</button>
        <h3 className="modal-title">Edit Recipe</h3>

        <div className="edit-form">
          <div className="edit-field">
            <label className="edit-label">Photo</label>
            {sourceImage && (
              <div className="recipe-photo-header" style={{ marginBottom: 8 }}>
                <img src={sourceImage} alt={title} className="recipe-photo-img" />
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handlePhotoFile}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn-ghost"
                style={{ flex: 1 }}
                onClick={() => fileInputRef.current?.click()}
                disabled={photoBusy}
              >
                {photoBusy ? '…' : sourceImage ? '📷 Replace' : '📷 Add Photo'}
              </button>
              {sourceImage && (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ flex: 1 }}
                  onClick={handlePhotoRemove}
                  disabled={photoBusy}
                >
                  {photoBusy ? '…' : '🗑 Remove'}
                </button>
              )}
            </div>
          </div>

          <div className="edit-field">
            <label className="edit-label">Title</label>
            <input
              className="input-field"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Recipe title"
            />
          </div>

          <div className="edit-field">
            <label className="edit-label">Description</label>
            <textarea
              className="input-field"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description"
              rows={2}
            />
          </div>

          <div className="edit-field">
            <label className="edit-label">
              Ingredients
              <span className="edit-count">{ingredients.filter(i => i.trim()).length}</span>
            </label>
            <div className="ingredient-edit-list">
              {ingredients.map((ing, i) => (
                <div key={i} className="ingredient-edit-row">
                  <input
                    className="input-field ingredient-edit-input"
                    value={ing}
                    onChange={e => updateIngredient(i, e.target.value)}
                    placeholder={`Ingredient ${i + 1}`}
                  />
                  <button
                    className="ingredient-remove-btn"
                    onClick={() => removeIngredient(i)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button className="add-ingredient-btn" onClick={addIngredient} type="button">
                + Add ingredient
              </button>
            </div>
          </div>

          <div className="edit-field">
            <label className="edit-label">Instructions</label>
            <textarea
              className="input-field"
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder="Step 1: ...&#10;Step 2: ..."
              rows={8}
            />
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="checklist-actions" style={{ marginTop: 8 }}>
            <button className="btn-ghost" onClick={handleCancel} disabled={photoBusy}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving || photoBusy || !title.trim()}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
