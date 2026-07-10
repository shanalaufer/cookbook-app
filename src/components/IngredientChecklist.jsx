import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useShoppingLists } from '../context/ShoppingListsContext'
import { categorizeWithOverrides } from '../lib/categorize'
import { normalizeCategory } from '../lib/categories'
import { parseIngredient } from '../lib/quantity'

// Accepts either a single recipe (ingredients[] + recipeName + recipeId) or a
// pre-built `entries` list of { label, recipeName, recipeId } — the planner uses
// the latter to add a whole day/week across several recipes, each keeping its
// own "Used in:" attribution. `title` overrides the modal heading.
export default function IngredientChecklist({
  ingredients, recipeName, recipeId, entries, title, onDone, onCancel,
}) {
  const { user } = useAuth()
  const { lists, activeListId } = useShoppingLists()

  const rows = entries ?? (ingredients ?? []).map(ing => ({
    label: ing, recipeName: recipeName ?? null, recipeId: recipeId ?? null,
  }))

  const [checked, setChecked] = useState(() => new Set(rows.map((_, i) => i)))
  const [targetListId, setTargetListId] = useState(activeListId)
  const [loading, setLoading] = useState(false)

  // Show the source recipe per row only when the list spans more than one recipe
  const multiRecipe = new Set(rows.map(r => r.recipeName)).size > 1

  function toggle(i) {
    const next = new Set(checked)
    next.has(i) ? next.delete(i) : next.add(i)
    setChecked(next)
  }

  function toggleAll() {
    setChecked(checked.size === rows.length ? new Set() : new Set(rows.map((_, i) => i)))
  }

  async function handleAdd() {
    const selected = rows.filter((_, i) => checked.has(i))
    if (!selected.length) { onDone(); return }
    setLoading(true)
    try {
      const parsed = selected.map(r => ({ ...parseIngredient(r.label), src: r }))
      const names = [...new Set(parsed.map(p => p.name))]

      let categories = {}
      try { categories = await categorizeWithOverrides(user.id, names) } catch { /* fallback to Other */ }

      const listId = targetListId ?? activeListId ?? lists[0]?.id ?? null
      const insertRows = parsed.map(({ name, amount, src }) => ({
        user_id: user.id,
        list_id: listId,
        ingredient: name,
        amount: amount || null,
        category: normalizeCategory(categories[name]),
        recipe_id: src.recipeId ?? null,
        recipe_name: src.recipeName ?? null,
        checked: false,
      }))
      await supabase.from('shopping_list').insert(insertRows)
      onDone()
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="checklist-header">
          <h3>{title ?? 'Add to Shopping List'}</h3>
          <p>Uncheck items you already have</p>
        </div>

        {lists.length > 1 && (
          <select
            className="input-field"
            value={targetListId ?? ''}
            onChange={e => setTargetListId(e.target.value)}
            style={{ marginBottom: 12 }}
          >
            {lists.map(l => <option key={l.id} value={l.id}>Add to: {l.name}</option>)}
          </select>
        )}

        <button className="select-all-btn" onClick={toggleAll}>
          {checked.size === rows.length ? 'Deselect all' : 'Select all'}
        </button>

        <div className="checklist-items">
          {rows.map((r, i) => (
            <label key={i} className="checklist-item">
              <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
              <span>
                {r.label}
                {multiRecipe && r.recipeName && (
                  <span className="checklist-source"> · {r.recipeName}</span>
                )}
              </span>
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
