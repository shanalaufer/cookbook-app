import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const CATEGORY_ORDER = ['Produce', 'Meat', 'Dairy', 'Bakery', 'Pantry', 'Frozen', 'Other']
const CATEGORY_ICONS = {
  Produce: '🥬', Meat: '🥩', Dairy: '🧀', Bakery: '🍞',
  Pantry: '🫙', Frozen: '🧊', Other: '🛒',
}

function groupItems(items) {
  const merged = {}
  for (const item of items) {
    const key = `${item.category}|||${item.ingredient.toLowerCase().trim()}`
    if (merged[key]) {
      if (item.recipe_name && !merged[key].recipe_names.includes(item.recipe_name)) {
        merged[key].recipe_names.push(item.recipe_name)
      }
      merged[key].ids.push(item.id)
      if (!item.checked) merged[key].checked = false
    } else {
      merged[key] = {
        ...item,
        recipe_names: item.recipe_name ? [item.recipe_name] : [],
        ids: [item.id],
      }
    }
  }

  const byCategory = {}
  for (const item of Object.values(merged)) {
    if (!byCategory[item.category]) byCategory[item.category] = []
    byCategory[item.category].push(item)
  }
  return byCategory
}

export default function ShoppingList() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [manualInput, setManualInput] = useState('')
  const [manualCategory, setManualCategory] = useState('Produce')
  const [loading, setLoading] = useState(true)
  const [editingItem, setEditingItem] = useState(null)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('Produce')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('shopping_list')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    setItems(data ?? [])
    setLoading(false)
  }, [user.id])

  useEffect(() => { load() }, [load])

  async function toggleItem(group) {
    const newChecked = !group.checked
    await supabase
      .from('shopping_list')
      .update({ checked: newChecked })
      .in('id', group.ids)
    setItems(prev => prev.map(i => group.ids.includes(i.id) ? { ...i, checked: newChecked } : i))
  }

  async function clearChecked() {
    const checkedItems = items.filter(i => i.checked)
    if (!checkedItems.length) return

    const clearedAt = new Date().toISOString()
    await supabase.from('shopping_history').insert(
      checkedItems.map(item => ({
        user_id:     item.user_id,
        ingredient:  item.ingredient,
        category:    item.category,
        recipe_name: item.recipe_name ?? null,
        cleared_at:  clearedAt,
      }))
    )

    await supabase.from('shopping_list').delete().in('id', checkedItems.map(i => i.id))
    setItems(prev => prev.filter(i => !i.checked))
  }

  function openEdit(group) {
    setEditName(group.ingredient)
    setEditCategory(group.category)
    setEditingItem(group)
  }

  async function saveEdit() {
    const name = editName.trim()
    if (!name) return
    await supabase
      .from('shopping_list')
      .update({ ingredient: name, category: editCategory })
      .in('id', editingItem.ids)
    setItems(prev => prev.map(i =>
      editingItem.ids.includes(i.id) ? { ...i, ingredient: name, category: editCategory } : i
    ))
    setEditingItem(null)
  }

  async function deleteItem(group) {
    await supabase.from('shopping_list').delete().in('id', group.ids)
    setItems(prev => prev.filter(i => !group.ids.includes(i.id)))
  }

  async function addManual(e) {
    e.preventDefault()
    if (!manualInput.trim()) return
    const { data } = await supabase
      .from('shopping_list')
      .insert({ user_id: user.id, ingredient: manualInput.trim(), category: manualCategory, checked: false })
      .select()
      .single()
    if (data) setItems(prev => [...prev, data])
    setManualInput('')
  }

  const groups = groupItems(items)
  const checkedCount = items.filter(i => i.checked).length
  const sortedCategories = CATEGORY_ORDER.filter(c => groups[c])

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1>Shopping List</h1>
          <p>{items.length - checkedCount} item{items.length - checkedCount !== 1 ? 's' : ''} remaining</p>
        </div>
        {checkedCount > 0 && (
          <button className="clear-btn" onClick={clearChecked}>
            Clear {checkedCount} checked
          </button>
        )}
      </div>

      <form className="manual-add-form" onSubmit={addManual}>
        <input
          placeholder="Add item…"
          value={manualInput}
          onChange={e => setManualInput(e.target.value)}
        />
        <select
          className="manual-category-select"
          value={manualCategory}
          onChange={e => setManualCategory(e.target.value)}
        >
          {CATEGORY_ORDER.map(c => (
            <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>
          ))}
        </select>
        <button type="submit">Add</button>
      </form>

      {loading && <div className="loading-state"><div className="spinner" /></div>}

      {!loading && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🛒</div>
          <p>Your shopping list is empty</p>
          <p className="hint">Add ingredients from any recipe, or type items above</p>
        </div>
      )}

      {sortedCategories.map(category => (
        <div key={category} className="category-group">
          <div className="category-title">
            {CATEGORY_ICONS[category]} {category}
          </div>
          {groups[category].map((group, i) => (
            <div
              key={i}
              className={`shopping-item${group.checked ? ' checked' : ''}`}
              onClick={() => toggleItem(group)}
            >
              <input
                type="checkbox"
                checked={group.checked}
                onChange={() => {}}
                onClick={e => e.stopPropagation()}
              />
              <div className="shopping-item-text">
                <div className="shopping-ingredient">{group.ingredient}</div>
                {group.recipe_names.length > 0 && (
                  <div className="shopping-recipe">({group.recipe_names.join(', ')})</div>
                )}
              </div>
              <div className="shopping-item-actions">
                <button
                  className="shopping-action-btn"
                  onClick={e => { e.stopPropagation(); openEdit(group) }}
                  aria-label="Edit"
                >✏️</button>
                <button
                  className="shopping-action-btn shopping-delete-btn"
                  onClick={e => { e.stopPropagation(); deleteItem(group) }}
                  aria-label="Delete"
                >×</button>
              </div>
            </div>
          ))}
        </div>
      ))}
      {editingItem && createPortal(
        <div className="modal-overlay" onClick={() => setEditingItem(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditingItem(null)}>✕</button>
            <h3 className="modal-title">Edit Item</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="settings-label">Item</label>
                <input
                  className="input-field"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  style={{ marginTop: 6 }}
                  autoFocus
                />
              </div>
              <div>
                <label className="settings-label">Category</label>
                <select
                  className="input-field"
                  value={editCategory}
                  onChange={e => setEditCategory(e.target.value)}
                  style={{ marginTop: 6 }}
                >
                  {CATEGORY_ORDER.map(c => (
                    <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="checklist-actions" style={{ marginTop: 20 }}>
              <button className="btn-ghost" onClick={() => setEditingItem(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveEdit} disabled={!editName.trim()}>Save</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
