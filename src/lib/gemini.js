import { GoogleGenerativeAI } from '@google/generative-ai'

const MODEL = 'gemini-3-flash-preview'

function getModel(systemInstruction) {
  const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY)
  return genAI.getGenerativeModel({ model: MODEL, systemInstruction })
}

function dietaryNote(restrictions) {
  if (!restrictions?.trim()) return ''
  return `\n\nDIETARY RESTRICTIONS — follow these strictly in every response: ${restrictions}`
}

function parseJSON(text, array = false) {
  const pattern = array ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/
  const match = text.match(pattern)
  if (!match) throw new Error('No JSON in Gemini response')
  try {
    return JSON.parse(match[0])
  } catch {
    return JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1'))
  }
}

export async function generateRecipeIdeas(query, dietaryRestrictions) {
  const model = getModel(
    `You are a creative cooking assistant.${dietaryNote(dietaryRestrictions)}`
  )
  const result = await model.generateContent(
    `The user wants: "${query}"

Generate exactly 3 recipe ideas. Return a raw JSON array (no markdown fences):
[
  {
    "title": "Recipe Name",
    "description": "2-3 enticing sentences about this dish",
    "ingredients": ["2 cups flour", "1 tsp salt"],
    "instructions": "1. Step one\\n2. Step two\\n3. Step three"
  }
]`
  )
  return parseJSON(result.response.text(), true)
}

export async function extractRecipeFromText(rawText, dietaryRestrictions) {
  const model = getModel(
    `You extract and structure recipes.${dietaryNote(dietaryRestrictions)}`
  )
  const result = await model.generateContent(
    `Extract and structure this recipe. Return raw JSON only:
{
  "title": "Recipe Name",
  "description": "Brief appealing description",
  "ingredients": ["amount ingredient"],
  "instructions": "1. Step\\n2. Step"
}

Recipe text:
${rawText}`
  )
  return parseJSON(result.response.text())
}

export async function extractRecipeFromUrl(url, pageText, dietaryRestrictions) {
  const model = getModel(
    `You extract recipes from webpage text.${dietaryNote(dietaryRestrictions)}`
  )
  const result = await model.generateContent(
    `Extract the recipe from this webpage. Return raw JSON only:
{
  "title": "Recipe Name",
  "description": "Brief appealing description",
  "ingredients": ["amount ingredient"],
  "instructions": "1. Step\\n2. Step"
}

URL: ${url}
Page text (truncated):
${pageText.slice(0, 8000)}`
  )
  return parseJSON(result.response.text())
}

export async function extractRecipeFromImage(base64Data, mimeType, dietaryRestrictions) {
  const model = getModel(
    `You extract recipes from images.${dietaryNote(dietaryRestrictions)}`
  )
  const result = await model.generateContent([
    {
      text: `Extract the recipe from this image. Return raw JSON only:
{
  "title": "Recipe Name",
  "description": "Brief appealing description",
  "ingredients": ["amount ingredient"],
  "instructions": "1. Step\\n2. Step"
}`,
    },
    { inlineData: { data: base64Data, mimeType } },
  ])
  return parseJSON(result.response.text())
}

export async function extractRecipeFromPdf(base64Data, dietaryRestrictions) {
  const model = getModel(
    `You extract recipes from documents.${dietaryNote(dietaryRestrictions)}`
  )
  const result = await model.generateContent([
    {
      text: `Extract the recipe from this PDF. Return raw JSON only:
{
  "title": "Recipe Name",
  "description": "Brief appealing description",
  "ingredients": ["amount ingredient"],
  "instructions": "1. Step\\n2. Step"
}`,
    },
    { inlineData: { data: base64Data, mimeType: 'application/pdf' } },
  ])
  return parseJSON(result.response.text())
}

export async function categorizeIngredients(ingredients) {
  const model = getModel()
  const result = await model.generateContent(
    `Categorize these grocery ingredients. Return raw JSON only mapping each ingredient to its category.
Categories: Produce, Meat, Dairy, Bakery, Pantry, Frozen, Other

Ingredients: ${JSON.stringify(ingredients)}

Return: {"ingredient name": "Category"}`
  )
  try {
    return parseJSON(result.response.text())
  } catch {
    return {}
  }
}

export async function chatWithAssistant(userMessage, history, dietaryRestrictions, cookbookContext) {
  const system =
    `You are a helpful personal cooking assistant with access to the user's cookbook.${dietaryNote(dietaryRestrictions)}` +
    (cookbookContext ? `\n\nUser's saved recipes:\n${cookbookContext}` : '')

  const model = getModel(system)
  const chat = model.startChat({
    history: history.map(m => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: [{ text: m.content }],
    })),
  })
  const result = await chat.sendMessage(userMessage)
  return result.response.text()
}
