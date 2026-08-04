import { GoogleGenerativeAI } from '@google/generative-ai'

// ─── Gemini — all AI tasks ───────────────────────────────
// (Groq was dropped: its edge network blocks some residential/VPN IPs with
// "Access denied", which broke text/URL extraction entirely.)
const GEMINI_MODEL = 'gemini-2.5-flash'

function getGeminiModel(systemInstruction) {
  const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY)
  return genAI.getGenerativeModel({ model: GEMINI_MODEL, systemInstruction })
}

// ─── Shared helpers ───────────────────────────────────────

function dietaryNote(restrictions) {
  if (!restrictions?.trim()) return ''
  return `\n\nDietary restrictions to always follow: ${restrictions}`
}

function cleanIngredient(str) {
  return str.replace(/\*{1,2}([^*]*)\*{1,2}/g, '$1').replace(/\*+/g, '').trim()
}

function cleanRecipe(recipe) {
  return { ...recipe, ingredients: (recipe.ingredients ?? []).map(cleanIngredient) }
}

function parseJSON(str, array = false) {
  const pattern = array ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/
  const match = str.match(pattern)
  if (!match) throw new Error('No JSON in AI response')
  try {
    return JSON.parse(match[0])
  } catch {
    return JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1'))
  }
}

function approxTokens(...strings) {
  return Math.round(strings.reduce((sum, s) => sum + (s?.length ?? 0), 0) / 4)
}

function is429(err) {
  return (
    err?.status === 429 ||
    String(err?.message).includes('429') ||
    /quota|rate.?limit/i.test(String(err?.message))
  )
}

async function timedCall(label, tokenStrings, fn, provider = 'Gemini') {
  const tokens = approxTokens(...tokenStrings)
  const start = performance.now()
  try {
    const result = await fn()
    const ms = Math.round(performance.now() - start)
    console.log(`[${provider}] ${label} — ${ms}ms, ~${tokens} tokens sent`)
    return result
  } catch (err) {
    const ms = Math.round(performance.now() - start)
    const rateLimit = is429(err)
    console.log(`[${provider}] ${label} — ${ms}ms, ~${tokens} tokens sent, ERROR${rateLimit ? ' ⚠️ 429 RATE LIMIT' : ''}: ${err?.message}`)
    throw err
  }
}

// One-shot text task: system instruction + prompt → response text
async function geminiText(system, prompt, label) {
  const model = getGeminiModel(system)
  const result = await timedCall(label, [system, prompt], () =>
    model.generateContent(prompt),
    'Gemini'
  )
  return result.response.text()
}

// ─── Recipe generation (Gemini) ───────────────────────────

export async function generateRecipeIdeas(query, dietaryRestrictions) {
  const system = `You're an enthusiastic home cook who loves sharing recipes. You know everything about food and get genuinely excited to help. When asked for recipe ideas, respond with ONLY a raw JSON array — no markdown fences, no commentary.${dietaryNote(dietaryRestrictions)}`
  const prompt = `Give me 3 recipe ideas for: ${query}\n\n[{"title":"","description":"2-3 exciting sentences","ingredients":["amount item"],"instructions":"1. Step\\n2. Step"}]`
  const model = getGeminiModel(system)
  const result = await timedCall('recipe generation', [system, prompt], () =>
    model.generateContent(prompt),
    'Gemini'
  )
  return parseJSON(result.response.text(), true).map(cleanRecipe)
}

// ─── Recipe extraction — text + URL (Gemini) ─────────────

export async function extractRecipeFromText(rawText, dietaryRestrictions) {
  const system = `You extract and structure recipes from text. Reply with raw JSON only — no markdown.${dietaryNote(dietaryRestrictions)}`
  const prompt = `Extract and structure this recipe:\n{"title":"","description":"Brief appealing description","ingredients":["amount item"],"instructions":"1. Step\\n2. Step"}\n\nText:\n${rawText}`
  const raw = await geminiText(system, prompt, 'extract recipe from text')
  return cleanRecipe(parseJSON(raw))
}

export async function extractRecipeFromUrl(url, pageText, dietaryRestrictions) {
  const system = `You extract recipes from webpage text. Reply with raw JSON only — no markdown.${dietaryNote(dietaryRestrictions)}`
  const truncated = pageText.slice(0, 8000)
  const prompt = `Extract the recipe from this page:\n{"title":"","description":"Brief appealing description","ingredients":["amount item"],"instructions":"1. Step\\n2. Step"}\n\nURL: ${url}\nPage text:\n${truncated}`
  const raw = await geminiText(system, prompt, 'extract recipe from URL')
  return cleanRecipe(parseJSON(raw))
}

// ─── Recipe extraction — PDF via Gemini (iOS fallback) ───

export async function extractRecipeFromPdf(base64Data, dietaryRestrictions) {
  const system = `You extract recipes from PDF documents. Reply with raw JSON only — no markdown.${dietaryNote(dietaryRestrictions)}`
  const prompt = `Extract the recipe from this PDF document:\n{"title":"","description":"Brief appealing description","ingredients":["amount item"],"instructions":"1. Step\\n2. Step"}`
  const model = getGeminiModel(system)
  const result = await timedCall(
    'extract recipe from PDF',
    [system, prompt],
    () => model.generateContent([
      { text: prompt },
      { inlineData: { data: base64Data, mimeType: 'application/pdf' } },
    ]),
    'Gemini'
  )
  return cleanRecipe(parseJSON(result.response.text()))
}

// ─── Recipe extraction — image (Gemini) ──────────────────

export async function extractRecipeFromImage(base64Data, mimeType, dietaryRestrictions) {
  const system = `You extract recipes from food images. Reply with raw JSON only — no markdown.${dietaryNote(dietaryRestrictions)}`
  const prompt = `Extract the recipe from this image:\n{"title":"","description":"Brief appealing description","ingredients":["amount item"],"instructions":"1. Step\\n2. Step"}`
  const model = getGeminiModel(system)
  const result = await timedCall(
    'extract recipe from image',
    [system, prompt],
    () => model.generateContent([
      { text: prompt },
      { inlineData: { data: base64Data, mimeType } },
    ]),
    'Gemini'
  )
  return cleanRecipe(parseJSON(result.response.text()))
}

// ─── Ingredient categorization (Gemini) ──────────────────

export async function categorizeIngredients(ingredients) {
  const system = `You are a grocery categorization expert. Assign every ingredient to exactly one of these categories:
- Protein: beef, chicken, pork, lamb, turkey, fish, shrimp, seafood, bacon, sausage, deli meats, eggs, tofu, tempeh
- Leafy Greens: lettuce, spinach, kale, arugula, chard, cabbage, romaine, mixed greens, collards, bok choy
- Vegetables: onion, garlic, carrots, celery, potatoes, tomatoes, mushrooms, bell peppers, zucchini, eggplant, corn, beets, radishes, cucumber, broccoli, cauliflower, squash, green beans
- Fruit: apples, banana, berries, lemon, lime, orange, grapes, melon, mango, avocado, peach, pear, pineapple
- Fresh Herbs: parsley, cilantro, basil, mint, dill, rosemary, thyme, sage, chives, tarragon (fresh, not dried)
- Healthy Fats: olive oil, avocado oil, coconut oil, nuts, seeds, nut butters, olives, tahini
- Refrigerated: milk, butter, cream, cheese, yogurt, sour cream, cream cheese, hummus, tofu if refrigerated, other dairy and chilled items
- Pantry: canned goods, vinegar, soy sauce, flour, sugar, rice, pasta, beans, lentils, dried grains, broth, stock, honey, maple syrup, bread, crackers, tortillas, condiments, tomato paste, canned tomatoes, coconut milk
- Spices & Seasonings: salt, pepper, dried spices, dried herbs, spice blends, bouillon, extracts, baking powder, baking soda
- Frozen: frozen vegetables, frozen meals, ice cream, frozen fruit, frozen meat if specified as frozen
- Supplements: vitamins, protein powder, collagen, supplements, electrolyte powders
- Other: non-food items, cleaning supplies, or anything that truly does not fit above`
  const prompt = `Categorize every ingredient. Return ONLY a raw JSON object — no explanation, no markdown:\n{"ingredient name": "Category"}\n\nIngredients: ${JSON.stringify(ingredients)}`
  const raw = await geminiText(system, prompt, 'ingredient categorization')
  try {
    return parseJSON(raw)
  } catch {
    return {}
  }
}

// ─── Chat (Gemini) ────────────────────────────────────────

export async function sendChatMessage(systemPrompt, history, userMessage) {
  const model = getGeminiModel(systemPrompt)

  // Gemini's startChat requires history to begin with a user turn and to
  // strictly alternate user/model — otherwise it throws. Reloaded history can
  // violate this (same-timestamp rows can come back out of order), so collapse
  // any consecutive same-role turns and drop leading model turns before sending.
  // Only the recent conversation is sent — older turns add cost and can steer
  // the model toward stale patterns (old action formats, old category names).
  const mapped = history
    .slice(-40)
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', text: m.rawContent ?? '' }))
    .filter(m => m.text.trim())

  const geminiHistory = []
  for (const turn of mapped) {
    const last = geminiHistory[geminiHistory.length - 1]
    if (last && last.role === turn.role) {
      last.parts[0].text += '\n\n' + turn.text
    } else {
      geminiHistory.push({ role: turn.role, parts: [{ text: turn.text }] })
    }
  }
  while (geminiHistory.length > 0 && geminiHistory[0].role === 'model') geminiHistory.shift()
  // Drop trailing user turn(s) so history ends on a model turn — otherwise the
  // user message we're about to send would create two user turns in a row, which
  // Gemini rejects. This also heals older histories that saved an empty AI reply.
  while (geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === 'user') geminiHistory.pop()

  const chat = model.startChat({ history: geminiHistory })
  const allText = systemPrompt + history.map(m => m.rawContent).join(' ') + userMessage
  const result = await timedCall('chat message', [allText], () =>
    chat.sendMessage(userMessage),
    'Gemini'
  )
  return result.response.text()
}
