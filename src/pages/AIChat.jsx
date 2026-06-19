import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { sendChatMessage } from '../lib/ai'
import RecipeFullView from '../components/RecipeFullView'
import ReactMarkdown from 'react-markdown'

// ─── System prompt ────────────────────────────────────────

function buildSystem(dietaryRestrictions, cookbookContext, shoppingHistory) {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10)
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' })

  const parts = [
    `You're a warm, knowledgeable friend who absolutely loves food and cooking. You give real, practical advice like you're chatting with a friend — enthusiastic but not over the top, helpful without being preachy. You know your way around a kitchen inside and out.

Today is ${dayName}, ${dateStr}.`,
  ]
  if (dietaryRestrictions?.trim())
    parts.push(`Dietary restrictions to always follow: ${dietaryRestrictions}`)
  if (cookbookContext)
    parts.push(`Here are the recipes they've saved in their cookbook:\n${cookbookContext}`)
  if (shoppingHistory)
    parts.push(`Their past shopping trips (so you know what they usually buy):\n${shoppingHistory}`)

  parts.push(`RESPONSE RULES — follow these exactly:

Be conversational first. Most messages should feel like texting a foodie friend — casual, warm, direct. Don't always jump to recipes.

Only generate recipe cards when the user clearly wants a full recipe ("give me a recipe for X", "how do I make X", "show me a pasta recipe"). Casual questions like "what should I have for breakfast?" → respond conversationally, maybe ask what they're in the mood for, suggest a direction. NEVER output recipe cards without also writing something — always include a comment, question, or note alongside them.

When you DO generate recipes, wrap the JSON in <recipes> tags and include conversational text before or after — never cards alone:
<recipes>[{"title":"Name","description":"2-3 sentences","ingredients":["amount item"],"instructions":"1. Step\\n2. Step"}]</recipes>

When suggesting multiple specific recipes, use recipe cards (the format above) rather than a plain text list.

ASSUMPTIONS — whenever you're not certain what the user means, briefly state what you inferred and where you got it from, then ask to confirm before acting. Example: 'I see Honey Garlic Pargiot in your shopping history — is that the one you meant?' or 'I'm assuming you mean next Thursday (June 19) — should I go ahead?' Never silently fill in an ambiguous blank.

ACTIONS — you can write directly to the user's app:

To add to the meal planner, include this tag in your response. Use the actual YYYY-MM-DD date — never the word "today":
<action>{"type":"add_meal","name":"Dish name","date":"${dateStr}","slot":"lunch"}</action>
Valid slots: breakfast, lunch, dinner, snack

To add to the shopping list:
<action>{"type":"add_shopping","items":[{"ingredient":"salmon","category":"Meat"},{"ingredient":"lemon","category":"Produce"}]}</action>
Categories: Produce, Meat, Dairy, Bakery, Pantry, Frozen, Other

When the user asks to add something, execute the action tag AND confirm in your text exactly what you added and when — one short sentence is enough. Do not list out the shopping list contents, do not summarize what else is on the list, do not mention other items. Just confirm what was added. Never repeat back or display the full shopping list or meal plan in the chat. Action tags are invisible to the user — your text is the only confirmation they see.`)

  return parts.join('\n\n')
}

// ─── Context relevance filters ────────────────────────────

function needsCookbookContext(text) {
  return /recipe|cookbook|saved|cook|ingredient|dish|meal|made|what.*(have|make)|my (recipe|food)|planner|add.*to.*(dinner|lunch|breakfast)/i.test(text)
}

function needsShoppingContext(text) {
  return /shop|buy|bought|groceri|ingredient|list|store|purchase|usually (buy|get)|do i have|missing/i.test(text)
}

// ─── Response parsing ─────────────────────────────────────

function tryParseRecipeArray(str) {
  try {
    const match = str.match(/\[[\s\S]*\]/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(r => r.title && Array.isArray(r.ingredients) && r.instructions)
    ) {
      return parsed.map(r => ({ ...r, source_type: 'ai', ingredients: r.ingredients ?? [] }))
    }
  } catch { /* not recipes */ }
  return null
}

// Parse a message into alternating text / recipe-card segments.
// Handles new <recipes>...</recipes> format and legacy bare JSON arrays.
function parseSegments(rawContent) {
  // New tagged format
  if (rawContent.includes('<recipes>')) {
    const segments = []
    const re = /<recipes>([\s\S]*?)<\/recipes>/g
    let lastIndex = 0
    let match
    while ((match = re.exec(rawContent)) !== null) {
      const before = rawContent.slice(lastIndex, match.index).trim()
      if (before) segments.push({ type: 'text', content: before })
      const recipes = tryParseRecipeArray(match[1].trim())
      if (recipes) segments.push({ type: 'recipes', content: recipes })
      lastIndex = match.index + match[0].length
    }
    const after = rawContent.slice(lastIndex).trim()
    if (after) segments.push({ type: 'text', content: after })
    if (segments.length) return segments
  }

  // Legacy: bare JSON array (no tags) — backward compat with old chat history
  const trimmed = rawContent.trim()
  if (trimmed.startsWith('[')) {
    const recipes = tryParseRecipeArray(trimmed)
    if (recipes) return [{ type: 'recipes', content: recipes }]
  }

  return [{ type: 'text', content: rawContent }]
}

// Strip <action> tags and return clean display text
function stripActionTags(text) {
  return text.replace(/<action>[\s\S]*?<\/action>/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

// ─── Action execution ─────────────────────────────────────

function resolveDate(dateStr) {
  if (!dateStr || dateStr === 'today') return new Date().toISOString().slice(0, 10)
  if (dateStr === 'tomorrow') {
    const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10)
  }
  return dateStr
}

async function executeActions(rawReply, userId) {
  const re = /<action>([\s\S]*?)<\/action>/g
  let match
  while ((match = re.exec(rawReply)) !== null) {
    try {
      const action = JSON.parse(match[1])
      if (action.type === 'add_meal') {
        const date = resolveDate(action.date)
        const { data: existing } = await supabase
          .from('meal_plan')
          .select('id')
          .eq('user_id', userId)
          .eq('date', date)
          .eq('meal_slot', action.slot)
          .maybeSingle()
        if (existing) {
          await supabase.from('meal_plan')
            .update({ custom_text: action.name, recipe_id: null })
            .eq('id', existing.id)
        } else {
          await supabase.from('meal_plan').insert({
            user_id: userId,
            date,
            meal_slot: action.slot,
            custom_text: action.name,
            recipe_id: null,
          })
        }
      } else if (action.type === 'add_shopping') {
        await supabase.from('shopping_list').insert(
          (action.items ?? []).map(item => ({
            user_id: userId,
            ingredient: item.ingredient,
            category: item.category ?? 'Other',
            checked: false,
          }))
        )
      }
    } catch (err) {
      console.warn('[Action] failed to execute:', match[1], err)
    }
  }
}

// ─── Component ────────────────────────────────────────────

export default function AIChat() {
  const { user, preferences } = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [savedTitles, setSavedTitles] = useState(new Set())
  const bottomRef = useRef(null)

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from('chat_history')
      .select('role,content')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(120)
    setMessages(
      (data ?? []).map(m => ({
        role: m.role === 'model' ? 'assistant' : 'user',
        rawContent: m.content,
      }))
    )
    setHistoryLoaded(true)
  }, [user.id])

  useEffect(() => { loadHistory() }, [loadHistory])

  useEffect(() => {
    if (historyLoaded) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, historyLoaded])

  async function getCookbookContext() {
    const { data } = await supabase
      .from('recipes')
      .select('title,description,ingredients')
      .eq('user_id', user.id)
      .limit(60)
    if (!data?.length) return null
    return data.map(r =>
      `- ${r.title}${r.description ? ': ' + r.description.slice(0, 80) : ''}${r.ingredients?.length ? ' [' + r.ingredients.join(', ') + ']' : ''}`
    ).join('\n')
  }

  async function getShoppingHistory() {
    const { data } = await supabase
      .from('shopping_history')
      .select('ingredient,category,recipe_name,cleared_at')
      .eq('user_id', user.id)
      .order('cleared_at', { ascending: false })
      .limit(300)
    if (!data?.length) return null
    const byDate = {}
    for (const row of data) {
      const date = row.cleared_at.slice(0, 10)
      if (!byDate[date]) byDate[date] = []
      byDate[date].push(row.recipe_name ? `${row.ingredient} (${row.recipe_name})` : row.ingredient)
    }
    return Object.entries(byDate)
      .slice(0, 30)
      .map(([date, items]) => `${date}: ${items.join(', ')}`)
      .join('\n')
  }

  async function sendMessage(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    setInput('')

    const userMsg = { role: 'user', rawContent: text }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const [cookbookContext, shoppingHistory] = await Promise.all([
        needsCookbookContext(text) ? getCookbookContext() : Promise.resolve(null),
        needsShoppingContext(text) ? getShoppingHistory() : Promise.resolve(null),
      ])
      const systemPrompt = buildSystem(preferences.dietary_restrictions, cookbookContext, shoppingHistory)
      const rawReply = await sendChatMessage(systemPrompt, messages, text)

      // Execute any embedded actions (meal planner / shopping list writes)
      await executeActions(rawReply, user.id)

      // Strip action tags before storing — text around them already confirms what happened
      const displayReply = stripActionTags(rawReply)

      setMessages(prev => [...prev, { role: 'assistant', rawContent: displayReply }])

      await supabase.from('chat_history').insert([
        { user_id: user.id, role: 'user',  content: text },
        { user_id: user.id, role: 'model', content: displayReply },
      ])
    } catch (err) {
      console.error('[Chat] send failed:', err)
      setMessages(prev => [
        ...prev,
        { role: 'assistant', rawContent: 'Sorry, something went wrong. Please try again.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  async function saveRecipe(recipe) {
    const { error } = await supabase.from('recipes').insert({
      user_id: user.id,
      title: recipe.title,
      description: recipe.description ?? '',
      ingredients: recipe.ingredients ?? [],
      instructions: recipe.instructions ?? '',
      source_type: 'ai',
    })
    if (!error) setSavedTitles(prev => new Set([...prev, recipe.title]))
  }

  async function clearHistory() {
    if (!confirm('Clear all chat history?')) return
    await supabase.from('chat_history').delete().eq('user_id', user.id)
    setMessages([])
  }

  // ─── Rendering ─────────────────────────────────────────

  function renderRecipeCard(recipe, j) {
    const isSaved = savedTitles.has(recipe.title)
    return (
      <div
        key={j}
        className="chat-recipe-card"
        onClick={() => setSelectedRecipe(recipe)}
      >
        <span className="source-tag tag-purple">AI Generated</span>
        <h4>{recipe.title}</h4>
        <p>{recipe.description}</p>
        <button
          className={`chat-save-btn${isSaved ? ' saved' : ''}`}
          onClick={e => { e.stopPropagation(); if (!isSaved) saveRecipe(recipe) }}
        >
          {isSaved ? '✓ Saved' : '⭐ Save'}
        </button>
      </div>
    )
  }

  function renderMessage(msg, i) {
    if (msg.role === 'user') {
      return (
        <div key={i} className="message user">
          <div className="message-bubble">{msg.rawContent}</div>
        </div>
      )
    }

    const segments = parseSegments(msg.rawContent)
    return (
      <div key={i} className="message-group">
        {segments.map((seg, j) => {
          if (seg.type === 'recipes') {
            return (
              <div key={j} className="message-recipes">
                {seg.content.map((recipe, k) => renderRecipeCard(recipe, k))}
              </div>
            )
          }
          return (
            <div key={j} className="message assistant">
              <div className="message-bubble markdown">
                <ReactMarkdown>{seg.content}</ReactMarkdown>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const isSavedSelected = selectedRecipe && savedTitles.has(selectedRecipe.title)

  return (
    <div className="page">
      <div className="page-header" style={{ paddingRight: 52 }}>
        <h1>AI Chat</h1>
        <p>Recipes, ideas, questions — ask anything</p>
      </div>

      {messages.length > 0 && (
        <button className="clear-btn" style={{ marginBottom: 8 }} onClick={clearHistory}>
          Clear history
        </button>
      )}

      <div className="chat-messages" style={{ paddingBottom: 100 }}>
        {!historyLoaded && <div className="loading-state"><div className="spinner" /></div>}

        {historyLoaded && messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">🤖</div>
            <p>Your AI cooking assistant</p>
            <p className="hint">
              Ask for recipe ideas, add meals to your planner, or just chat about food.
            </p>
            <div className="chat-suggestions">
              {[
                'What should I make for dinner tonight?',
                'Add salmon to Thursday dinner',
                'Show me my saved pasta recipes',
                'Add eggs and milk to my shopping list',
              ].map(s => (
                <button key={s} className="suggestion-chip" onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => renderMessage(msg, i))}

        {loading && (
          <div className="message assistant">
            <div className="message-bubble typing">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input-bar" onSubmit={sendMessage}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask anything…"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>→</button>
      </form>

      {selectedRecipe && (
        <RecipeFullView
          recipe={selectedRecipe}
          onClose={() => setSelectedRecipe(null)}
          onSave={isSavedSelected ? undefined : () => { saveRecipe(selectedRecipe); setSelectedRecipe(null) }}
          showSaveButton={!isSavedSelected}
        />
      )}
    </div>
  )
}
