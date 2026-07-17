import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useShoppingLists } from '../context/ShoppingListsContext'
import { supabase } from '../lib/supabase'
import { sendChatMessage } from '../lib/ai'
import { resolveListByName, getLists } from '../lib/lists'
import { normalizeCategory } from '../lib/categories'
import { ingredientKey } from '../lib/quantity'
import { getCategoryOverrides, rememberCategory } from '../lib/categorize'
import RecipeFullView from '../components/RecipeFullView'
import ReactMarkdown from 'react-markdown'

// ─── System prompt ────────────────────────────────────────

function buildSystem(dietaryRestrictions, cookbookContext, shoppingHistory, listContext, plannerContext, allListsContents) {
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
  if (listContext)
    parts.push(listContext)
  if (allListsContents)
    parts.push(`Live contents of every shopping list, fetched just now. Trust THIS over anything said earlier in the conversation when adding, removing, deduping, or answering questions about the lists:\n${allListsContents}`)
  if (plannerContext)
    parts.push(`Their meal planner (so you can turn planned meals into shopping items):\n${plannerContext}`)

  parts.push(`RESPONSE RULES — follow these exactly:

Be conversational first. Most messages should feel like texting a foodie friend — casual, warm, direct. Don't always jump to recipes.

Only generate recipe cards when the user clearly wants a full recipe ("give me a recipe for X", "how do I make X", "show me a pasta recipe"). Casual questions like "what should I have for breakfast?" → respond conversationally, maybe ask what they're in the mood for, suggest a direction. NEVER output recipe cards without also writing something — always include a comment, question, or note alongside them.

When you DO generate recipes, wrap the JSON in <recipes> tags and include conversational text before or after — never cards alone:
<recipes>[{"title":"Name","description":"2-3 sentences","ingredients":["amount item"],"instructions":"1. Step\\n2. Step"}]</recipes>

When suggesting multiple specific recipes, use recipe cards (the format above) rather than a plain text list.

ASSUMPTIONS — whenever you're not certain what the user means, briefly state what you inferred and where you got it from, then ask to confirm before acting. Example: 'I see Honey Garlic Pargiot in your shopping history — is that the one you meant?' or 'I'm assuming you mean next Thursday (June 19) — should I go ahead?' Never silently fill in an ambiguous blank.

ACTIONS — how you actually write to the user's app:

The user's shopping list and meal planner live in a database. The ONLY thing that writes to that database is an <action> tag in your reply. Your conversational text does NOTHING — it does not add anything. If you say "Added salmon to your list!" but do not emit an <action> tag, you have LIED to the user: nothing was added. This is the single most important rule you have.

THEREFORE: Any time the user asks you to add, put, throw, or stick something on their shopping list, or to add/plan/schedule a meal, you MUST include the matching <action> tag in that same response. No exceptions. Never claim you added something without the tag. If you are about to write a confirmation sentence, the tag MUST already be in your reply.

Shopping actions take an optional "list" — the name of the list to act on. Match it to one of the user's existing lists shown above; omit it (or use the active list's name) when they don't specify. A list named in "list"/"to"/"create_list" that doesn't exist yet is created automatically.

To add to a shopping list, emit:
<action>{"type":"add_shopping","list":"Costco","items":[{"ingredient":"salmon","category":"Protein"},{"ingredient":"lemon","category":"Fruit"}]}</action>
Categories: Protein, Leafy Greens, Vegetables, Fruit, Fresh Herbs, Healthy Fats, Refrigerated, Pantry, Spices & Seasonings, Frozen, Supplements, Other

Before adding, check the live list contents above. If something the user asks to add is already on the target list, leave it out of the action and tell them it's already there — never claim you added an item that was already present. The app also skips duplicates at insert time, so a confirmation that doesn't match the live contents will be visibly wrong to the user.

To remove items from a shopping list, emit (just the ingredient names):
<action>{"type":"remove_shopping","list":"Costco","items":["salmon","lemon"]}</action>

To change an item's category (also remembered for all future lists):
<action>{"type":"set_category","ingredient":"tahini","category":"Healthy Fats"}</action>

To remove duplicate items from a list (keeps one of each ingredient):
<action>{"type":"dedupe_shopping","list":"Costco"}</action>

To create a new shopping list:
<action>{"type":"create_list","name":"Phase 1"}</action>

To move the checked-off items from the active list into another list:
<action>{"type":"move_checked","to":"Week 2"}</action>

To add to the meal planner, emit (use the actual YYYY-MM-DD date — never the word "today"):
<action>{"type":"add_meal","name":"Dish name","date":"${dateStr}","slot":"lunch"}</action>
Valid slots: breakfast, lunch, dinner, snack

When the user asks to add planned meals to a list ("add this week's dinners to Costco"), look up those meals in their meal planner above, find each recipe's ingredients in their cookbook, and emit a single add_shopping with all those ingredients and the target list.

Worked examples — follow these exactly:

User: "add eggs and milk to my shopping list"
You: <action>{"type":"add_shopping","items":[{"ingredient":"eggs","category":"Protein"},{"ingredient":"milk","category":"Refrigerated"}]}</action>Done — added eggs and milk to your list! 🛒

User: "add the ingredients from Dalia's Mayo to Costco"
You: <action>{"type":"add_shopping","list":"Costco","items":[{"ingredient":"eggs","category":"Protein"},{"ingredient":"lemon juice","category":"Fruit"},{"ingredient":"oil","category":"Healthy Fats"}]}</action>Added Dalia's Mayo ingredients to your Costco list!

User: "create a shopping list for Phase 1"
You: <action>{"type":"create_list","name":"Phase 1"}</action>Created your Phase 1 list! 📝

User: "move the checked items into a new list called Week 2"
You: <action>{"type":"move_checked","to":"Week 2"}</action>Moved your checked items over to Week 2.

User: "delete the duplicates on my list" / "remove duplicate items"
You: <action>{"type":"dedupe_shopping"}</action>Cleaned up the duplicates on your list! ✅

User: "move tahini to healthy fats" / "tahini isn't pantry, it's a healthy fat"
You: <action>{"type":"set_category","ingredient":"tahini","category":"Healthy Fats"}</action>Moved tahini to Healthy Fats — I'll remember that from now on.

User: "put salmon on Thursday for dinner"
You: <action>{"type":"add_meal","name":"Salmon","date":"${dateStr}","slot":"dinner"}</action>Got it — salmon's on the menu for Thursday dinner.

User: "take eggs off my list" / "I already have salmon"
You: <action>{"type":"remove_shopping","items":["eggs"]}</action>Done — removed that from your shopping list!

Output the raw <action> tag exactly as shown — never wrap it in backticks or a code block, never explain it, never describe the JSON. The tag is invisible to the user; only your sentence shows.

Emit ONLY the action type that matches the request — never substitute a different action because none fits. If no action can do what the user asked, say you can't do that yet instead of emitting a tag. Your confirmation sentence must describe what your tag actually did — never reuse a confirmation sentence from an unrelated example.

After emitting the tag, confirm in ONE short sentence exactly what you added. Do not list out the shopping list contents, do not summarize what else is on the list, do not mention other items. Never repeat back or display the full shopping list or meal plan.`)

  return parts.join('\n\n')
}

// ─── Context relevance filters ────────────────────────────

function needsCookbookContext(text) {
  return /recipe|cookbook|saved|cook|ingredient|dish|meal|made|what.*(have|make)|my (recipe|food)|planner|add.*to.*(dinner|lunch|breakfast)/i.test(text)
}

function needsPlannerContext(text) {
  return /planner|planned|meal plan|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|dinners?|lunches|breakfasts/i.test(text)
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

// Insert items into a list: the user's remembered category overrides beat the
// model's guess. Ingredients already on the list aren't re-inserted, but they're
// returned as `skipped` (and insert errors as `failed`) so the chat can tell the
// user what really happened instead of letting a claimed "Added!" stand.
// Batch-internal repeats just collapse to one row — they still count as added.
async function insertShoppingItems(userId, listId, items) {
  const result = { added: [], skipped: [], failed: [] }
  const clean = (items ?? []).filter(i => i?.ingredient?.trim())
  if (!clean.length || !listId) return result
  const overrides = await getCategoryOverrides(userId, clean.map(i => i.ingredient))
  const { data: existing } = await supabase
    .from('shopping_list')
    .select('ingredient')
    .eq('user_id', userId)
    .eq('list_id', listId)
  const have = new Set((existing ?? []).map(r => ingredientKey(r.ingredient)))
  const inBatch = new Set()
  const rows = []
  for (const item of clean) {
    const name = item.ingredient.trim()
    const key = ingredientKey(name)
    if (have.has(key)) { result.skipped.push(name); continue }
    if (inBatch.has(key)) continue
    inBatch.add(key)
    rows.push({
      user_id: userId,
      list_id: listId,
      ingredient: name,
      amount: item.amount || null,
      category: overrides[key] ?? overrides[name.toLowerCase()] ?? normalizeCategory(item.category),
      checked: false,
    })
  }
  if (!rows.length) return result
  const { error } = await supabase.from('shopping_list').insert(rows)
  if (error) {
    console.error('[Action] shopping list insert failed:', error)
    result.failed.push(...rows.map(r => r.ingredient))
  } else {
    result.added.push(...rows.map(r => r.ingredient))
  }
  return result
}

// Executes embedded <action> tags. activeListId is the fallback list when the
// model doesn't name one. Returns whether any shopping list was created/changed
// (so the caller can refresh the list switcher) plus the add outcomes, so the
// visible reply can be corrected when the model's confirmation overpromised.
async function executeActions(rawReply, userId, activeListId) {
  const re = /<action>([\s\S]*?)<\/action>/g
  let match
  let found = false
  let listsChanged = false
  const added = [], skipped = [], failed = []
  const collect = res => { added.push(...res.added); skipped.push(...res.skipped); failed.push(...res.failed) }
  while ((match = re.exec(rawReply)) !== null) {
    found = true
    try {
      // Gemini occasionally wraps the JSON in backticks — strip them before parsing
      const jsonStr = match[1].trim().replace(/^`+|`+$/g, '').trim()
      const action = JSON.parse(jsonStr)
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
        const listId = await resolveListByName(userId, action.list, { create: true, fallbackListId: activeListId })
        if (action.list) listsChanged = true   // a named list may have just been created
        collect(await insertShoppingItems(userId, listId, action.items))
      } else if (action.type === 'remove_shopping') {
        // Fetch then match by normalized key so "avocados" removes "avocado, diced"
        const listId = await resolveListByName(userId, action.list, { fallbackListId: activeListId })
        let q = supabase.from('shopping_list').select('id,ingredient').eq('user_id', userId)
        if (listId) q = q.eq('list_id', listId)
        const { data: rows } = await q
        for (const entry of action.items ?? []) {
          const name = (typeof entry === 'string' ? entry : entry?.ingredient)?.trim()
          if (!name) continue
          const target = ingredientKey(name)
          const ids = (rows ?? []).filter(r => ingredientKey(r.ingredient) === target).map(r => r.id)
          if (!ids.length) continue
          const { error } = await supabase.from('shopping_list').delete().in('id', ids)
          if (error) console.error('[Action] shopping list delete failed:', error)
        }
      } else if (action.type === 'create_list') {
        const listId = await resolveListByName(userId, action.name, { create: true })
        listsChanged = true
        if (action.items?.length) collect(await insertShoppingItems(userId, listId, action.items))
      } else if (action.type === 'move_checked') {
        const target = await resolveListByName(userId, action.to, { create: true })
        if (target && activeListId) {
          const { error } = await supabase
            .from('shopping_list')
            .update({ list_id: target, checked: false })
            .eq('user_id', userId)
            .eq('list_id', activeListId)
            .eq('checked', true)
          if (error) console.error('[Action] move_checked failed:', error)
          else listsChanged = true
        }
      } else if (action.type === 'set_category') {
        // Change item(s) category on a list AND remember the choice for the future
        const listId = await resolveListByName(userId, action.list, { fallbackListId: activeListId })
        const changes = action.items ?? [{ ingredient: action.ingredient, category: action.category }]
        const { data: rows } = listId
          ? await supabase.from('shopping_list').select('id,ingredient').eq('user_id', userId).eq('list_id', listId)
          : { data: [] }
        for (const ch of changes) {
          const name = (ch?.ingredient ?? '').trim()
          if (!name) continue
          const category = normalizeCategory(ch?.category)
          const target = ingredientKey(name)
          const ids = (rows ?? [])
            .filter(r => ingredientKey(r.ingredient) === target)
            .map(r => r.id)
          if (ids.length) {
            const { error } = await supabase.from('shopping_list').update({ category }).in('id', ids)
            if (error) console.error('[Action] set_category failed:', error)
          }
          // Remember even if no row matched right now — future adds will use it
          await rememberCategory(userId, target, category)
        }
      } else if (action.type === 'dedupe_shopping') {
        // Deterministically drop duplicate rows on a list — keep the earliest of
        // each ingredient (case-insensitive), delete the rest.
        const listId = await resolveListByName(userId, action.list, { fallbackListId: activeListId })
        if (listId) {
          const { data } = await supabase
            .from('shopping_list')
            .select('id,ingredient')
            .eq('user_id', userId)
            .eq('list_id', listId)
            .order('created_at', { ascending: true })
          const seen = new Set()
          const dupeIds = []
          for (const row of data ?? []) {
            // Normalized key: amounts stripped, plurals folded, prep words and
            // trailing context ignored — "avocados" ≈ "avocado, diced"
            const k = ingredientKey(row.ingredient)
            if (seen.has(k)) dupeIds.push(row.id)
            else seen.add(k)
          }
          if (dupeIds.length) {
            const { error } = await supabase.from('shopping_list').delete().in('id', dupeIds)
            if (error) console.error('[Action] dedupe failed:', error)
          }
        }
      }
    } catch (err) {
      console.error('[Action] failed to execute tag content:', match[1], err)
    }
  }
  if (!found) console.log('[Action] no <action> tags found in reply:', rawReply.slice(0, 400))
  return { listsChanged, added, skipped, failed }
}

// ─── Component ────────────────────────────────────────────

export default function AIChat() {
  const { user, preferences } = useAuth()
  const { lists, activeListId, refreshLists } = useShoppingLists()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [savedTitles, setSavedTitles] = useState(new Set())
  const bottomRef = useRef(null)

  const loadHistory = useCallback(async () => {
    // Fetch the NEWEST 120 rows (descending), then reverse for display.
    // Ascending+limit would return the oldest 120 ever — once the table grows
    // past the limit, new messages save but never load, "vanishing" on reload.
    const { data } = await supabase
      .from('chat_history')
      .select('role,content')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(120)
    setMessages(
      (data ?? [])
        .reverse()
        .filter(m => (m.content ?? '').trim())   // skip legacy empty rows (blank bubbles / poison)
        .map(m => ({
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

  // Current + next two weeks of planner entries, so the AI can expand
  // "add this week's dinners to X" into ingredients via the cookbook context.
  async function getPlannerContext() {
    const start = new Date().toISOString().slice(0, 10)
    const endDate = new Date(); endDate.setDate(endDate.getDate() + 14)
    const end = endDate.toISOString().slice(0, 10)
    const { data } = await supabase
      .from('meal_plan')
      .select('date,meal_slot,custom_text,recipes(title)')
      .eq('user_id', user.id)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true })
    if (!data?.length) return null
    return data
      .map(r => `${r.date} ${r.meal_slot}: ${r.recipes?.title ?? r.custom_text ?? ''}`.trim())
      .filter(Boolean)
      .join('\n')
  }

  function buildListContext() {
    if (!lists.length) return null
    const active = lists.find(l => l.id === activeListId)
    return `The user's shopping lists: ${lists.map(l => l.name).join(', ')}.` +
      (active ? ` The active list is "${active.name}" — use it when they don't name one.` : '')
  }

  // Live contents of EVERY list, fetched fresh from the database at send time —
  // so removes/dedupes on non-active lists aren't blind, and the model never has
  // to reconstruct list state from stale chat history. Lists come from the DB
  // too (not React state) so ones created moments ago by an action are included.
  async function getAllListsContext() {
    const [allLists, { data: rows }] = await Promise.all([
      getLists(user.id),
      supabase
        .from('shopping_list')
        .select('ingredient,amount,category,checked,list_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true }),
    ])
    if (!allLists.length) return null
    const byList = {}
    for (const r of rows ?? []) (byList[r.list_id] ??= []).push(r)
    return allLists.map(l => {
      const header = `List "${l.name}"${l.id === activeListId ? ' (ACTIVE)' : ''}:`
      const items = byList[l.id] ?? []
      if (!items.length) return `${header} (empty)`
      return header + '\n' + items
        .map(r => `- ${r.amount ? r.amount + ' ' : ''}${r.ingredient} [${r.category}]${r.checked ? ' (checked)' : ''}`)
        .join('\n')
    }).join('\n\n')
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
      // Shopping context is ALWAYS fetched fresh — a shopping action is possible
      // on any message, and keyword-gating it left the model acting on stale
      // chat history whenever the phrasing didn't match the regex.
      const [cookbookContext, shoppingHistory, plannerContext, allListsContents] = await Promise.all([
        needsCookbookContext(text) ? getCookbookContext() : Promise.resolve(null),
        getShoppingHistory(),
        needsPlannerContext(text) ? getPlannerContext() : Promise.resolve(null),
        getAllListsContext(),
      ])
      const systemPrompt = buildSystem(
        preferences.dietary_restrictions, cookbookContext, shoppingHistory,
        buildListContext(), plannerContext, allListsContents,
      )
      const rawReply = await sendChatMessage(systemPrompt, messages, text)

      // Execute any embedded actions (meal planner / shopping list writes)
      const { listsChanged, added, skipped, failed } = await executeActions(rawReply, user.id, activeListId)
      if (listsChanged) refreshLists()

      // Strip action tags before storing — text around them already confirms what happened.
      // Never store an empty reply: an empty model turn gets filtered on reload, which
      // leaves history ending on a user turn and breaks Gemini's alternation on the next send.
      let displayReply = stripActionTags(rawReply) || 'Done! ✅'

      // Honesty guard: the model writes its confirmation before the database is
      // touched, so if items were skipped as duplicates or the insert failed,
      // correct the record in the visible reply. This also lands in saved
      // history, so future turns see what actually happened.
      if (skipped.length) {
        const names = [...new Set(skipped)].join(', ')
        displayReply += added.length
          ? `\n\n_(Already on the list, so not added again: ${names}.)_`
          : `\n\n_(Nothing new was added — already on the list: ${names}.)_`
      }
      if (failed.length) {
        displayReply += `\n\n_(Couldn't save to the list: ${[...new Set(failed)].join(', ')} — please try again.)_`
      }

      setMessages(prev => [...prev, { role: 'assistant', rawContent: displayReply }])

      // Explicit, distinct timestamps: a batch insert would give both rows the
      // same created_at (Postgres now() is per-transaction), leaving reload
      // ordering ambiguous — which then breaks Gemini's alternation requirement.
      const stamp = Date.now()
      const { error: saveError } = await supabase.from('chat_history').insert([
        { user_id: user.id, role: 'user',  content: text,         created_at: new Date(stamp).toISOString() },
        { user_id: user.id, role: 'model', content: displayReply, created_at: new Date(stamp + 1).toISOString() },
      ])
      if (saveError) console.error('[Chat] failed to save history:', saveError)
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
