import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'

// ─── Groq — primary AI for all text tasks ────────────────
const GROQ_MODEL = 'llama-3.3-70b-versatile'

function getGroqClient() {
  return new OpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: import.meta.env.VITE_GROQ_API_KEY,
    dangerouslyAllowBrowser: true,
  })
}

// ─── Gemini — used only for image vision ─────────────────
const GEMINI_MODEL = 'gemini-2.0-flash'

function getGeminiModel(systemInstruction) {
  const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY)
  return genAI.getGenerativeModel({ model: GEMINI_MODEL, systemInstruction })
}

// ─── Shared helpers ───────────────────────────────────────

function responseText(completion) {
  return completion.choices[0].message.content
}

function dietaryNote(restrictions) {
  if (!restrictions?.trim()) return ''
  return `\n\nDietary restrictions to always follow: ${restrictions}`
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

async function timedCall(label, tokenStrings, fn, provider = 'Groq') {
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

async function groqChat(messages, label) {
  const client = getGroqClient()
  const tokenStrings = messages.map(m =>
    typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  )
  const completion = await timedCall(label, tokenStrings, () =>
    client.chat.completions.create({ model: GROQ_MODEL, messages })
  )
  return responseText(completion)
}

// ─── Recipe generation (Groq) ─────────────────────────────

export async function generateRecipeIdeas(query, dietaryRestrictions) {
  const system = `You're an enthusiastic home cook who loves sharing recipes. You know everything about food and get genuinely excited to help. When asked for recipe ideas, respond with ONLY a raw JSON array — no markdown fences, no commentary.${dietaryNote(dietaryRestrictions)}`
  const prompt = `Give me 3 recipe ideas for: ${query}\n\n[{"title":"","description":"2-3 exciting sentences","ingredients":["amount item"],"instructions":"1. Step\\n2. Step"}]`
  const raw = await groqChat([
    { role: 'system', content: system },
    { role: 'user',   content: prompt },
  ], 'recipe generation')
  return parseJSON(raw, true)
}

// ─── Recipe extraction — text + URL (Groq) ───────────────

export async function extractRecipeFromText(rawText, dietaryRestrictions) {
  const system = `You extract and structure recipes from text. Reply with raw JSON only — no markdown.${dietaryNote(dietaryRestrictions)}`
  const prompt = `Extract and structure this recipe:\n{"title":"","description":"Brief appealing description","ingredients":["amount item"],"instructions":"1. Step\\n2. Step"}\n\nText:\n${rawText}`
  const raw = await groqChat([
    { role: 'system', content: system },
    { role: 'user',   content: prompt },
  ], 'extract recipe from text')
  return parseJSON(raw)
}

export async function extractRecipeFromUrl(url, pageText, dietaryRestrictions) {
  const system = `You extract recipes from webpage text. Reply with raw JSON only — no markdown.${dietaryNote(dietaryRestrictions)}`
  const truncated = pageText.slice(0, 8000)
  const prompt = `Extract the recipe from this page:\n{"title":"","description":"Brief appealing description","ingredients":["amount item"],"instructions":"1. Step\\n2. Step"}\n\nURL: ${url}\nPage text:\n${truncated}`
  const raw = await groqChat([
    { role: 'system', content: system },
    { role: 'user',   content: prompt },
  ], 'extract recipe from URL')
  return parseJSON(raw)
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
  return parseJSON(result.response.text())
}

// ─── Ingredient categorization (Groq) ────────────────────

export async function categorizeIngredients(ingredients) {
  const system = `You are a grocery categorization expert. Assign every ingredient to exactly one of these categories:
- Produce: all fresh or raw vegetables, fruits, herbs, and leafy greens (e.g. cabbage, onion, garlic, carrots, celery, lettuce, spinach, kale, tomatoes, potatoes, apples, lemon, lime, parsley, cilantro, basil, ginger, avocado, mushrooms, bell peppers, zucchini, eggplant, corn, beets, radishes, cucumber, broccoli, cauliflower)
- Meat: beef, chicken, pork, lamb, turkey, fish, shrimp, seafood, bacon, sausage, deli meats, eggs
- Dairy: milk, butter, cream, cheese, yogurt, sour cream, cream cheese, half-and-half, heavy cream, ice cream
- Bakery: bread, rolls, tortillas, pita, buns, bagels, pastries, cake, crackers
- Pantry: canned goods, oils, vinegar, soy sauce, flour, sugar, rice, pasta, beans, lentils, nuts, seeds, dried spices, seasonings, condiments, broth, stock, honey, maple syrup, chocolate chips, cocoa powder, baking powder, baking soda, salt, pepper, hot sauce, tomato paste, canned tomatoes, coconut milk
- Frozen: frozen vegetables, frozen meals, ice cream, frozen fruit, frozen meat if specified as frozen
- Other: non-food items, cleaning supplies, or anything that truly does not fit above`
  const prompt = `Categorize every ingredient. Return ONLY a raw JSON object — no explanation, no markdown:\n{"ingredient name": "Category"}\n\nIngredients: ${JSON.stringify(ingredients)}`
  const client = getGroqClient()
  const completion = await timedCall('ingredient categorization', [system, prompt], () =>
    client.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: prompt },
      ],
    })
  )
  try {
    return parseJSON(responseText(completion))
  } catch {
    return {}
  }
}

// ─── Chat (Groq) ──────────────────────────────────────────

export async function sendChatMessage(systemPrompt, history, userMessage) {
  const client = getGroqClient()
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.rawContent,
    })),
    { role: 'user', content: userMessage },
  ]
  const allText = systemPrompt + history.map(m => m.rawContent).join(' ') + userMessage
  const completion = await timedCall('chat message', [allText], () =>
    client.chat.completions.create({ model: GROQ_MODEL, messages })
  )
  return responseText(completion)
}
