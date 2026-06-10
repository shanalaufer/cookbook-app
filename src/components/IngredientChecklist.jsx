import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { categorizeIngredients } from '../lib/gemini'

export default function IngredientChecklist({ ingredients, recipeName, recipeId, onDone, onCancel }) {
  const { user } = useAuth()
  const [checked, setChecked] = useState(() => new Set(ingredients.map((_, i) => i)))
  const [loading, setLoading] = useState(false)

  function toggle(i) {
    const next = new Set(checked)
    next.has(i) ? next.delete(i) : next.add(i)
    setChecked(next)
  }

  function toggleAll() {
    setChecked(checked.size === ingredients.length ? new Set() : new Set(ingredients.map((_, i) => i)))
  }

  async function handleAdd() {
    const selected = ingredients.filter((_, i) => checked.has(i))
    if (!selected.length) { onDone(); return }
    setLoading(true)
    try {
      let categories = {}
      try { categories = await categorizeIngredients(selected) } catch { /* fallback to Other */ }

      const rows = selected.map(ing => ({
        user_id: user.id,
        ingredient: ing,
        category: categories[ing] ?? categories[ing.toLowerCase()] ?? 'Other',
        recipe_id: recipeId ?? null,
        recipe_name: recipeName ?? null,
        checked: false,
      }))
      await supabase.from('shopping_list').insert(rows)
      onDone()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="checklist-header">
          <h3>Add to Shopping List</h3>
          <p>Uncheck items you already have</p>
        </div>

        <button className="select-all-btn" onClick={toggleAll}>
          {checked.size === ingredients.length ? 'Deselect all' : 'Select all'}
        </button>

        <div className="checklist-items">
          {ingredients.map((ing, i) => (
            <label key={i} className="checklist-item">
              <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
              <span>{ing}</span>
            </label>
          ))}
        </div>

        <div className="checklist-actions">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleAdd} disabled={loading || !checked.size}>
            {loading ? 'Adding…' : `Add ${checked.size} item${checked.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
