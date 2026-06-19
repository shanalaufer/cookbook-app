import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { categorizeIngredients } from '../lib/ai'

// Splits "2 cups flour" → { amount: "2 cups", name: "flour" }
// Strings with no leading quantity → { amount: "", name: <original> }
function parseIngredient(raw) {
  const str = raw.trim()
  const m = str.match(
    /^([\d¼½¾⅓⅔⅛⅜⅝⅞][\d\s./\-–]*(?:\([^)]*\)\s*)?(?:cups?|tbsps?|tsps?|tablespoons?|teaspoons?|fl\.?\s*oz|fluid\s+oz|ounces?|oz|pounds?|lbs?|lb|grams?|g|kg|ml|liters?|l|quarts?|qt|pints?|pt|gallons?|cans?|jars?|pkgs?|packages?|cloves?|heads?|bunches?|slices?|pieces?|stalks?|sprigs?|large|medium|small|whole)?)\s+(.+)/i
  )
  if (m && m[2].trim()) return { amount: m[1].trim(), name: m[2].trim() }
  return { amount: '', name: str }
}

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
      const parsed = selected.map(parseIngredient)
      const names = parsed.map(p => p.name)

      let categories = {}
      try { categories = await categorizeIngredients(names) } catch { /* fallback to Other */ }

      const rows = parsed.map(({ name, amount }) => ({
        user_id: user.id,
        ingredient: name,
        category: categories[name] ?? categories[name.toLowerCase()] ?? 'Other',
        recipe_id: recipeId ?? null,
        recipe_name: amount && recipeName ? `${amount} · ${recipeName}` : (recipeName ?? null),
        checked: false,
      }))
      await supabase.from('shopping_list').insert(rows)
      onDone()
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
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
    </div>,
    document.body
  )
}
