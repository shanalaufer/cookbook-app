import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack']
const SLOT_ICONS = { breakfast: '☀️', lunch: '🌤️', dinner: '🌙', snack: '🍎' }

function getWeekDates(offset = 0) {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function toDateStr(date) {
  return date.toISOString().slice(0, 10)
}

function isToday(date) {
  return toDateStr(date) === toDateStr(new Date())
}

export default function MealPlanner() {
  const { user } = useAuth()
  const [weekOffset, setWeekOffset] = useState(0)
  const [plans, setPlans] = useState({})
  const [recipes, setRecipes] = useState([])
  const [editing, setEditing] = useState(null)
  const [editText, setEditText] = useState('')
  const [editRecipeId, setEditRecipeId] = useState('')

  const days = getWeekDates(weekOffset)

  const load = useCallback(async () => {
    const start = toDateStr(days[0])
    const end = toDateStr(days[6])
    const { data } = await supabase
      .from('meal_plan')
      .select('*, recipes(title)')
      .eq('user_id', user.id)
      .gte('date', start)
      .lte('date', end)
    const map = {}
    for (const row of data ?? []) {
      map[`${row.date}:${row.meal_slot}`] = row
    }
    setPlans(map)
  }, [user.id, weekOffset]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.from('recipes').select('id,title').eq('user_id', user.id).order('title')
      .then(({ data }) => setRecipes(data ?? []))
  }, [user.id])

  function openEdit(date, slot) {
    const key = `${toDateStr(date)}:${slot}`
    const existing = plans[key]
    setEditText(existing?.custom_text ?? '')
    setEditRecipeId(existing?.recipe_id ?? '')
    setEditing({ date: toDateStr(date), slot, key, existingId: existing?.id })
  }

  async function saveMeal() {
    const { date, slot, key, existingId } = editing
    const payload = {
      user_id: user.id,
      date,
      meal_slot: slot,
      recipe_id: editRecipeId || null,
      custom_text: !editRecipeId ? editText || null : null,
    }
    if (existingId) {
      await supabase.from('meal_plan').update(payload).eq('id', existingId)
    } else {
      await supabase.from('meal_plan').insert(payload)
    }
    setEditing(null)
    load()
  }

  async function clearMeal() {
    const { key, existingId } = editing
    if (existingId) {
      await supabase.from('meal_plan').delete().eq('id', existingId)
    }
    setPlans(prev => { const next = { ...prev }; delete next[key]; return next })
    setEditing(null)
  }

  const weekLabel = (() => {
    const start = days[0]
    const end = days[6]
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  })()

  return (
    <div className="page">
      <div className="page-header">
        <h1>Meal Planner</h1>
      </div>

      <div className="week-nav">
        <button onClick={() => setWeekOffset(w => w - 1)}>‹</button>
        <h2>{weekLabel}</h2>
        <button onClick={() => setWeekOffset(w => w + 1)}>›</button>
      </div>

      {days.map(date => (
        <div key={toDateStr(date)} className="day-card">
          <div className={`day-header${isToday(date) ? ' today' : ''}`}>
            <span>{date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            {isToday(date) && <span className="today-badge">Today</span>}
          </div>
          <div className="meal-slots">
            {SLOTS.map(slot => {
              const entry = plans[`${toDateStr(date)}:${slot}`]
              const label = entry?.recipes?.title ?? entry?.custom_text ?? null
              return (
                <div key={slot} className="meal-slot" onClick={() => openEdit(date, slot)}>
                  <span className="meal-slot-icon">{SLOT_ICONS[slot]}</span>
                  <span className="meal-slot-label">{slot}</span>
                  {label
                    ? <span className="meal-slot-content">{label}</span>
                    : <span className="meal-slot-empty">—</span>
                  }
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditing(null)}>✕</button>
            <h3 className="modal-title" style={{ textTransform: 'capitalize' }}>
              {SLOT_ICONS[editing.slot]} {editing.slot} · {editing.date}
            </h3>

            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="settings-label">From your cookbook</label>
                <select
                  className="input-field"
                  value={editRecipeId}
                  onChange={e => { setEditRecipeId(e.target.value); if (e.target.value) setEditText('') }}
                  style={{ marginTop: 6 }}
                >
                  <option value="">— None —</option>
                  {recipes.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </div>

              <div className="divider">or type something</div>

              <input
                className="input-field"
                placeholder="e.g. eating out, leftovers…"
                value={editText}
                onChange={e => { setEditText(e.target.value); if (e.target.value) setEditRecipeId('') }}
              />
            </div>

            <div className="checklist-actions" style={{ marginTop: 20 }}>
              {editing.existingId && (
                <button className="btn-ghost" onClick={clearMeal}>Clear</button>
              )}
              <button
                className="btn-primary"
                onClick={saveMeal}
                disabled={!editRecipeId && !editText.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
