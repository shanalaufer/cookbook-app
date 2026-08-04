import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../context/AuthContext'
import { useShoppingLists } from '../context/ShoppingListsContext'
import { supabase } from '../lib/supabase'
import { CATEGORY_ICONS, CATEGORY_ORDER, CATEGORY_SET, sortCategories } from '../lib/categories'
import { createList, renameList, duplicateList, deleteList } from '../lib/lists'
import { categorizeWithOverrides, rememberCategory } from '../lib/categorize'
import { mergeAmounts, ingredientKey } from '../lib/quantity'

function groupItems(items) {
  const merged = {}
  for (const item of items) {
    // Manual items (no recipe source) never merge — each gets its own row.
    // Recipe items merge on the normalized key so "avocado" ≈ "avocados, diced".
    const key = item.recipe_name
      ? `${item.category}|||${ingredientKey(item.ingredient)}`
      : `manual|||${item.id}`
    if (merged[key]) {
      if (item.recipe_name && !merged[key].recipe_names.includes(item.recipe_name)) {
        merged[key].recipe_names.push(item.recipe_name)
      }
      if (item.amount && !merged[key].amounts.includes(item.amount)) {
        merged[key].amounts.push(item.amount)
      }
      merged[key].ids.push(item.id)
      if (!item.checked) merged[key].checked = false
    } else {
      merged[key] = {
        ...item,
        recipe_names: item.recipe_name ? [item.recipe_name] : [],
        amounts: item.amount ? [item.amount] : [],
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
  const { lists, activeListId, setActiveList, refreshLists, ready, error } = useShoppingLists()
  const [items, setItems] = useState([])
  const [manualInput, setManualInput] = useState('')
  const [manualCategory, setManualCategory] = useState('Other')
  const [loading, setLoading] = useState(true)
  const [editingItem, setEditingItem] = useState(null)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('Other')
  const [showListMenu, setShowListMenu] = useState(false)

  const activeList = lists.find(l => l.id === activeListId) ?? null

  // One-time cleanup: items carrying a legacy/unknown category (e.g. from before
  // the 12-category scheme) get re-sorted via the override-aware categorizer.
  const recategorizeUnknowns = useCallback(async (rows) => {
    const stale = rows.filter(i => !CATEGORY_SET.has(i.category))
    if (!stale.length) return
    const cats = await categorizeWithOverrides(user.id, stale.map(i => i.ingredient))
    const updates = stale
      .map(i => ({ id: i.id, category: cats[i.ingredient] }))
      .filter(u => u.category && u.category !== 'Other')
    if (!updates.length) return
    await Promise.all(
      updates.map(u => supabase.from('shopping_list').update({ category: u.category }).eq('id', u.id))
    )
    const byId = Object.fromEntries(updates.map(u => [u.id, u.category]))
    setItems(prev => prev.map(i => byId[i.id] ? { ...i, category: byId[i.id] } : i))
  }, [user.id])

  // Monotonic counter so an in-flight load for a previous list can't overwrite
  // the items of the list selected after it.
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    if (!activeListId) { setItems([]); setLoading(false); return }
    const seq = ++loadSeq.current
    setLoading(true)
    const { data, error: qErr } = await supabase
      .from('shopping_list')
      .select('*')
      .eq('user_id', user.id)
      .eq('list_id', activeListId)
      .order('created_at', { ascending: true })
    if (seq !== loadSeq.current) return   // superseded by a newer load
    if (qErr) {
      // Keep whatever is on screen — an error must not render as an empty list
      console.error('[Shopping] load failed (has the migration been run?):', qErr.message)
      setLoading(false)
      return
    }
    const rows = data ?? []
    setItems(rows)
    setLoading(false)
    recategorizeUnknowns(rows)
  }, [user.id, activeListId, recategorizeUnknowns])

  // Wait for the lists context before querying — avoids a null-list hang
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState runs after the await, not synchronously
  useEffect(() => { if (ready) load() }, [ready, load])

  async function toggleItem(group) {
    const newChecked = !group.checked
    const { error } = await supabase
      .from('shopping_list')
      .update({ checked: newChecked })
      .in('id', group.ids)
    if (error) { console.error('[Shopping] toggle failed:', error); return }
    setItems(prev => prev.map(i => group.ids.includes(i.id) ? { ...i, checked: newChecked } : i))
  }

  async function clearChecked() {
    const checkedItems = items.filter(i => i.checked)
    if (!checkedItems.length) return

    const clearedAt = new Date().toISOString()
    const { error: historyError } = await supabase.from('shopping_history').insert(
      checkedItems.map(item => ({
        user_id:     item.user_id,
        ingredient:  item.ingredient,
        category:    item.category,
        recipe_name: item.recipe_name ?? null,
        cleared_at:  clearedAt,
      }))
    )
    if (historyError) {
      console.error('[Shopping] history insert failed:', historyError)
      alert("Couldn't record shopping history — nothing was cleared. Please try again.")
      return
    }

    const { error: deleteError } = await supabase
      .from('shopping_list').delete().in('id', checkedItems.map(i => i.id))
    if (deleteError) {
      console.error('[Shopping] clear failed:', deleteError)
      alert("Couldn't clear the checked items — please try again.")
      return
    }
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
    const { error } = await supabase
      .from('shopping_list')
      .update({ ingredient: name, category: editCategory })
      .in('id', editingItem.ids)
    if (error) {
      console.error('[Shopping] edit failed:', error)
      alert("Couldn't save the change — please try again.")
      return
    }
    setItems(prev => prev.map(i =>
      editingItem.ids.includes(i.id) ? { ...i, ingredient: name, category: editCategory } : i
    ))
    // Remember this categorization so the same ingredient lands here next time
    if (editCategory !== editingItem.category || name !== editingItem.ingredient) {
      rememberCategory(user.id, name, editCategory)
    }
    setEditingItem(null)
  }

  async function deleteItem(group) {
    const { error } = await supabase.from('shopping_list').delete().in('id', group.ids)
    if (error) {
      console.error('[Shopping] delete failed:', error)
      alert("Couldn't delete that item — please try again.")
      return
    }
    setItems(prev => prev.filter(i => !group.ids.includes(i.id)))
  }

  async function addManual(e) {
    e.preventDefault()
    if (!manualInput.trim() || !activeListId) return
    const { data, error } = await supabase
      .from('shopping_list')
      .insert({
        user_id: user.id,
        list_id: activeListId,
        ingredient: manualInput.trim(),
        category: manualCategory,
        checked: false,
      })
      .select()
      .single()
    if (error) {
      // Keep the typed text so the user can just hit Add again
      console.error('[Shopping] add failed:', error)
      alert("Couldn't add that item — please try again.")
      return
    }
    if (data) setItems(prev => [...prev, data])
    setManualInput('')
  }

  // ─── List management ─────────────────────────────────────
  async function handleNewList() {
    const name = prompt('Name your new list:')?.trim()
    if (!name) return
    try {
      const list = await createList(user.id, name)
      await refreshLists()
      setActiveList(list.id)
      setShowListMenu(false)
    } catch (err) {
      console.error('[Lists] create failed:', err)
      alert("Couldn't create the list — please try again.")
    }
  }

  async function handleRenameList() {
    const name = prompt('Rename list:', activeList?.name)?.trim()
    if (!name || !activeList) return
    try {
      await renameList(activeList.id, name)
      await refreshLists()
      setShowListMenu(false)
    } catch (err) {
      console.error('[Lists] rename failed:', err)
      alert("Couldn't rename the list — please try again.")
    }
  }

  async function handleDuplicateList() {
    if (!activeList) return
    const name = prompt('Name for the copy:', `${activeList.name} copy`)?.trim()
    if (!name) return
    try {
      const list = await duplicateList(user.id, activeList.id, name)
      await refreshLists()
      setActiveList(list.id)
      setShowListMenu(false)
    } catch (err) {
      console.error('[Lists] duplicate failed:', err)
      alert("Couldn't copy the list — please check it before relying on the copy.")
    }
  }

  async function handleDeleteList() {
    if (!activeList) return
    if (lists.length <= 1) { alert("You can't delete your only list."); return }
    if (!confirm(`Delete "${activeList.name}" and all its items?`)) return
    try {
      await deleteList(activeList.id)
      const remaining = await refreshLists()
      setActiveList((remaining.find(l => l.is_default) ?? remaining[0])?.id ?? null)
      setShowListMenu(false)
    } catch (err) {
      console.error('[Lists] delete failed:', err)
      alert("Couldn't delete the list — please try again.")
    }
  }

  const groups = groupItems(items)
  const checkedCount = items.filter(i => i.checked).length
  const sortedCategories = sortCategories(Object.keys(groups))

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

      <div className="list-switcher">
        <select
          className="list-switcher-select"
          value={activeListId ?? ''}
          onChange={e => setActiveList(e.target.value)}
        >
          {lists.map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <button className="list-switcher-menu-btn" onClick={() => setShowListMenu(true)} aria-label="Manage lists">
          ⋯
        </button>
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

      {(!ready || loading) && !error && <div className="loading-state"><div className="spinner" /></div>}

      {error && (
        <div className="empty-state">
          <div className="empty-icon">⚠️</div>
          <p>Couldn't load your shopping lists</p>
          <p className="hint">Make sure the database migration has been run in Supabase, then reload. Check the browser console for details.</p>
        </div>
      )}

      {ready && !error && !loading && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🛒</div>
          <p>This list is empty</p>
          <p className="hint">Add ingredients from any recipe, or type items above</p>
        </div>
      )}

      {sortedCategories.map(category => (
        <div key={category} className="category-group">
          <div className="category-title">
            {CATEGORY_ICONS[category] ?? '📦'} {category}
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
                <div className="shopping-ingredient">
                  {(() => { const a = mergeAmounts(group.amounts); return a && <span className="shopping-amount">{a} </span> })()}
                  {group.ingredient}
                </div>
                {group.recipe_names.length > 0 && (
                  <div className="shopping-recipe">Used in: {group.recipe_names.join(', ')}</div>
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

      {showListMenu && createPortal(
        <div className="modal-overlay" onClick={() => setShowListMenu(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowListMenu(false)}>✕</button>
            <h3 className="modal-title">Manage Lists</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              <button className="btn-secondary" onClick={handleNewList}>➕ New list</button>
              <button className="btn-ghost" onClick={handleRenameList}>✏️ Rename “{activeList?.name}”</button>
              <button className="btn-ghost" onClick={handleDuplicateList}>📄 Duplicate “{activeList?.name}”</button>
              <button className="btn-danger" onClick={handleDeleteList}>🗑 Delete “{activeList?.name}”</button>
            </div>
          </div>
        </div>,
        document.body
      )}

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
