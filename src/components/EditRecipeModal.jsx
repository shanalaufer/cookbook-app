import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function EditRecipeModal({ recipe, onClose, onSaved }) {
  const [title, setTitle] = useState(recipe.title)
  const [description, setDescription] = useState(recipe.description ?? '')
  const [ingredients, setIngredients] = useState(recipe.ingredients ?? [])
  const [instructions, setInstructions] = useState(recipe.instructions ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function updateIngredient(i, value) {
    setIngredients(prev => prev.map((ing, idx) => idx === i ? value : ing))
  }

  function removeIngredient(i) {
    setIngredients(prev => prev.filter((_, idx) => idx !== i))
  }

  function addIngredient() {
    setIngredients(prev => [...prev, ''])
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
        })
        .eq('id', recipe.id)
      if (err) throw err
      onSaved({ ...recipe, title: title.trim(), description: description.trim(), ingredients: cleanIngredients, instructions: instructions.trim() })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h3 className="modal-title">Edit Recipe</h3>

        <div className="edit-form">
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
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving || !title.trim()}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
