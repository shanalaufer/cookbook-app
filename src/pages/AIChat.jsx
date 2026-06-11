import { useState, useEffect, useRef, useCallback } from 'react'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import RecipeFullView from '../components/RecipeFullView'

const MODEL = 'gemini-3-flash-preview'

function buildSystem(dietaryRestrictions, cookbookContext, shoppingHistory) {
  const parts = ['You are a personal cooking assistant.']
  if (dietaryRestrictions?.trim())
    parts.push(`DIETARY RESTRICTIONS (follow strictly): ${dietaryRestrictions}`)
  if (cookbookContext)
    parts.push(`USER'S SAVED RECIPES: ${cookbookContext}`)
  if (shoppingHistory)
    parts.push(`PAST SHOPPING (by date):\n${shoppingHistory}`)
  parts.push(
    `For recipe requests (suggest, generate, ideas, "recipe for", "how to make", "what can I make"):\nReply ONLY with a raw JSON array — no other text:\n[{"title":"Name","description":"2-3 sentences","ingredients":["amount item"],"instructions":"1. Step\\n2. Step"}]\n\nFor everything else: plain conversational text.`
  )
  return parts.join('\n\n')
}

function needsCookbookContext(text) {
  return /recipe|cookbook|saved|cook|ingredient|dish|meal|made|what.*(have|make)|my (recipe|food)/i.test(text)
}

function needsShoppingContext(text) {
  return /shop|buy|bought|groceri|ingredient|list|store|purchase|usually (buy|get)|do i have|missing/i.test(text)
}

function tryParseRecipes(text) {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
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

export default function AIChat() {
  const { user, preferences } = useAuth()
  // messages: { role: 'user'|'assistant', rawContent: string }
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
    if (historyLoaded) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
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

    // Group by cleared_at date so each "shopping trip" is one line
    const byDate = {}
    for (const row of data) {
      const date = row.cleared_at.slice(0, 10)
      if (!byDate[date]) byDate[date] = []
      const entry = row.recipe_name ? `${row.ingredient} (${row.recipe_name})` : row.ingredient
      byDate[date].push(entry)
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

    // Add user message and show typing indicator immediately — before any async work
    const userMsg = { role: 'user', rawContent: text }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      // Only fetch context that's relevant to this specific message
      const [cookbookContext, shoppingHistory] = await Promise.all([
        needsCookbookContext(text) ? getCookbookContext() : Promise.resolve(null),
        needsShoppingContext(text) ? getShoppingHistory() : Promise.resolve(null),
      ])
      const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY)
      const model = genAI.getGenerativeModel({
        model: MODEL,
        systemInstruction: buildSystem(preferences.dietary_restrictions, cookbookContext, shoppingHistory),
      })

      // Pass all prior messages as history (current message is sent separately)
      const history = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.rawContent }],
      }))
      const chat = model.startChat({ history })
      const result = await chat.sendMessage(text)
      const rawReply = result.response.text()

      setMessages(prev => [...prev, { role: 'assistant', rawContent: rawReply }])

      await supabase.from('chat_history').insert([
        { user_id: user.id, role: 'user',  content: text },
        { user_id: user.id, role: 'model', content: rawReply },
      ])
    } catch {
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

  function renderMessage(msg, i) {
    if (msg.role === 'user') {
      return (
        <div key={i} className="message user">
          <div className="message-bubble">{msg.rawContent}</div>
        </div>
      )
    }

    const recipes = tryParseRecipes(msg.rawContent)
    if (recipes) {
      return (
        <div key={i} className="message-recipes">
          {recipes.map((recipe, j) => {
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
          })}
        </div>
      )
    }

    // Plain text response
    return (
      <div key={i} className="message assistant">
        <div className="message-bubble">
          {msg.rawContent.split('\n').map((line, j, arr) => (
            <span key={j}>{line}{j < arr.length - 1 && <br />}</span>
          ))}
        </div>
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
              Ask for recipe ideas, search your cookbook, get cooking tips — anything food related.
            </p>
            <div className="chat-suggestions">
              {[
                'Quick weeknight dinners',
                'What can I make with chicken?',
                'Show me my saved pasta recipes',
                'Healthy breakfast ideas',
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
