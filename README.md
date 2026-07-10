# My Cookbook

A personal AI-powered cookbook and kitchen assistant, built as a mobile-first Progressive Web App (PWA). Save recipes, plan your week, manage your shopping list, and chat with an AI that knows your kitchen.

---

## What It Does

My Cookbook is a full-stack PWA that combines recipe management with a conversational AI assistant. You can:

- Save recipes from any source — URL, photo, PDF, text paste, or drag-and-drop
- Chat with an AI cooking assistant that knows your saved recipes, dietary restrictions, and shopping history
- Ask the AI to add meals directly to your weekly planner or items to your shopping list
- Plan your week meal-by-meal with a built-in calendar view
- Manage a categorized shopping list that archives your history for AI context
- Install it to your phone's home screen and use it offline like a native app

---

## Features

### AI Chat
- Conversational assistant powered by Llama 3.3 70B via Groq — responds like a knowledgeable food-loving friend, not a recipe vending machine
- Casual questions get conversational replies; explicit recipe requests get interactive recipe cards
- Generates multiple recipe suggestions as tappable cards (not a text list)
- **Actions**: the AI can write directly to your app — say "add salmon to Thursday dinner" or "add eggs and milk to my shopping list" and it actually does it
- Full conversation history persisted in Supabase; history is sent with every request for continuity
- Knows your saved cookbook (titles + ingredients) and past shopping history for personalized suggestions
- Dietary restrictions are injected into every AI request automatically
- Console logs every AI call with duration, token estimate, and 429 detection for debugging

### Cookbook
- Grid view of all saved recipes with cover photos
- **Add recipes** via five methods: URL import, text paste, photo/image upload, PDF upload, or drag-and-drop files onto the modal
- URL import extracts `og:image` / `twitter:image` meta tags automatically as the cover photo
- Instagram links show a friendly error instead of a failed fetch
- **Edit** any recipe after saving — title, description, ingredients, instructions
- **Photo management** — upload, change, or remove a cover photo on any saved recipe (stored in Supabase Storage)
- Search recipes by title (visible when you have more than 4 saved)
- Expandable ingredient preview in the add modal

### Shopping List
- Add ingredients from any recipe via a checklist picker (AI-categorized automatically)
- Manually add items with a category selector
- Items grouped by category: Produce, Meat, Dairy, Bakery, Pantry, Frozen, Other
- Duplicate ingredients merged across recipes
- Check off items; clearing checked items archives them to `shopping_history` (used by the AI as context)

### Meal Planner
- Weekly calendar view with previous/next week navigation
- Four meal slots per day: Breakfast, Lunch, Dinner, Snack
- Link a saved recipe from your cookbook or type free text (e.g. "eating out", "leftovers")
- AI can populate meal slots directly from chat ("add pargiot to tonight's dinner")

### Discover
- Dedicated screen for generating recipe ideas from a prompt
- Results shown as recipe cards; tap to view full recipe or save to cookbook

### Settings
- Dietary restrictions field — saved to Supabase and sent with every AI request
- Account info and sign out
- Shows current AI model

### Auth
- Email/password sign-up and login
- Google OAuth ("Continue with Google")
- All data is scoped per user with Supabase Row Level Security

### PWA
- Installable to home screen on iOS and Android
- Offline-capable via a network-first service worker with cache fallback
- Standalone display mode (no browser chrome), portrait orientation
- Theme color matches the app's warm terracotta palette

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19 + Vite 8 |
| Routing | React Router v7 |
| Styling | Plain CSS with custom properties (no CSS framework) |
| Backend / Auth / DB | Supabase (PostgreSQL + Auth + Storage) |
| AI — chat, recipes, text | Groq API · `llama-3.3-70b-versatile` via OpenAI-compatible SDK |
| AI — image + PDF extraction | Google Gemini 2.0 Flash · `@google/generative-ai` |
| PWA | Manual `manifest.json` + `sw.js` (no Vite plugin) |

---

## File Structure

```
cookbook-app/
├── public/
│   ├── manifest.json        # PWA manifest (name, icons, theme color)
│   ├── sw.js                # Service worker — network-first fetch with cache fallback
│   ├── favicon.svg
│   └── icons.svg
│
├── src/
│   ├── main.jsx             # React entry point; registers the service worker
│   ├── App.jsx              # Root router, auth guard, gear button overlay, bottom nav layout
│   ├── index.css            # Full design system — CSS variables, all component styles
│   ├── App.css              # Minimal root-level overrides
│   │
│   ├── assets/
│   │   └── hero.png         # Static image asset
│   │
│   ├── context/
│   │   └── AuthContext.jsx  # Auth state provider; loads/saves user_preferences from Supabase;
│   │                        # exposes user, preferences, signIn, signUp, signOut, updatePreferences
│   │
│   ├── lib/
│   │   ├── supabase.js      # Supabase client (reads VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
│   │   └── ai.js            # All AI calls — Groq for text tasks, Gemini for image/PDF;
│   │                        # exports: generateRecipeIdeas, extractRecipeFromText,
│   │                        # extractRecipeFromUrl, extractRecipeFromImage, extractRecipeFromPdf,
│   │                        # categorizeIngredients, sendChatMessage
│   │
│   ├── pages/
│   │   ├── Auth.jsx         # Login / sign-up / Google OAuth screen
│   │   ├── AIChat.jsx       # Conversational AI — builds system prompt with dietary restrictions +
│   │   │                    # cookbook context + shopping history; executes <action> tags from AI
│   │   │                    # responses to write to meal_plan and shopping_list; renders mixed
│   │   │                    # text + recipe card segments
│   │   ├── Cookbook.jsx     # Recipe grid; handles add, edit, delete, photo upload to Supabase Storage
│   │   ├── Discover.jsx     # Prompt-based AI recipe generation with save-to-cookbook
│   │   ├── ShoppingList.jsx # Categorized list; manual add with category picker; archives
│   │   │                    # checked items to shopping_history on clear
│   │   ├── MealPlanner.jsx  # Weekly calendar; edit modal links saved recipes or free text
│   │   └── Settings.jsx     # Dietary restrictions (persisted to user_preferences); account info
│   │
│   └── components/
│       ├── BottomNav.jsx         # 4-tab navigation: AI Chat, Cookbook, Shopping, Planner
│       ├── RecipeCard.jsx        # Thumbnail card shown in grids — cover photo, title, source tag
│       ├── RecipeFullView.jsx    # Full recipe modal — ingredients, instructions, photo management,
│       │                         # add-to-shopping-list, edit, delete
│       ├── AddRecipeModal.jsx    # Multi-method recipe importer — URL (with og:image extraction),
│       │                         # text paste, photo upload, PDF upload, drag-and-drop;
│       │                         # shows friendly error for Instagram URLs
│       ├── EditRecipeModal.jsx   # Inline editor for title, description, ingredients, instructions
│       └── IngredientChecklist.jsx # Ingredient picker before adding to shopping list;
│                                    # calls categorizeIngredients for automatic category assignment
│
├── .env                     # Environment variables (not committed)
├── package.json
└── vite.config.js
```

---

## Supabase Tables

Run these in your Supabase SQL editor to create the schema.

### `recipes`
Stores saved recipes for each user.

```sql
create table recipes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  title        text not null,
  description  text default '',
  ingredients  text[] default '{}',
  instructions text default '',
  source_type  text default 'manual',  -- 'manual' | 'ai' | 'url' | 'photo' | 'pdf'
  source_url   text,
  source_image text,                   -- public URL of cover photo
  created_at   timestamptz default now()
);
alter table recipes enable row level security;
create policy "Users manage own recipes" on recipes
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `shopping_lists`
Named shopping lists. Each user can have many (e.g. "Week 1", "Costco", "Shabbat").

```sql
create table shopping_lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  name       text not null,
  is_default boolean default false,
  created_at timestamptz default now()
);
alter table shopping_lists enable row level security;
create policy "Users manage own shopping lists" on shopping_lists
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index shopping_lists_user_idx on shopping_lists(user_id);
```

### `shopping_list`
Shopping list items. Each item belongs to a `shopping_lists` row via `list_id`.

```sql
create table shopping_list (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  list_id     uuid references shopping_lists(id) on delete cascade,
  ingredient  text not null,
  amount      text,                   -- e.g. "2 cups" (kept separate from the name)
  category    text default 'Other',   -- one of the 12 categories (see below)
  recipe_name text,                   -- source recipe title (for "Used in:")
  checked     boolean default false,
  created_at  timestamptz default now()
);
alter table shopping_list enable row level security;
create policy "Users manage own shopping list" on shopping_list
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index shopping_list_list_idx on shopping_list(list_id);
```

Categories: 🥩 Protein · 🥬 Leafy Greens · 🥒 Vegetables · 🍎 Fruit · 🌿 Fresh Herbs ·
🥜 Healthy Fats · 🥛 Refrigerated · 🥫 Pantry · 🧂 Spices & Seasonings · 🧊 Frozen ·
💊 Supplements · 📦 Other

### `ingredient_categories`
Per-user category overrides. When a user re-files an ingredient, the choice is remembered
and reused when that ingredient is added to any future list.

```sql
create table ingredient_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  ingredient text not null,          -- lowercased, trimmed clean name
  category   text not null,
  updated_at timestamptz default now(),
  unique (user_id, ingredient)
);
alter table ingredient_categories enable row level security;
create policy "Users manage own ingredient categories" on ingredient_categories
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `shopping_history`
Archived items that were checked off. Used by the AI as context for what the user usually buys.

```sql
create table shopping_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  ingredient  text not null,
  category    text,
  recipe_name text,
  cleared_at  timestamptz not null
);
alter table shopping_history enable row level security;
create policy "Users manage own shopping history" on shopping_history
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `meal_plan`
Weekly meal planner entries.

```sql
create table meal_plan (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  date        date not null,
  meal_slot   text not null,  -- breakfast | lunch | dinner | snack
  recipe_id   uuid references recipes(id) on delete set null,
  custom_text text,
  created_at  timestamptz default now()
);
alter table meal_plan enable row level security;
create policy "Users manage own meal plan" on meal_plan
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `chat_history`
AI conversation history, loaded on chat open and sent with each request for continuity.

```sql
create table chat_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  role       text not null,  -- 'user' | 'model'
  content    text not null,
  created_at timestamptz default now()
);
alter table chat_history enable row level security;
create policy "Users manage own chat history" on chat_history
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `user_preferences`
Per-user settings — dietary restrictions and any stored API keys.

```sql
create table user_preferences (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references auth.users(id) on delete cascade not null unique,
  dietary_restrictions text default '',
  gemini_api_key       text default '',
  active_list_id       uuid references shopping_lists(id) on delete set null,
  updated_at           timestamptz default now()
);
alter table user_preferences enable row level security;
create policy "Users manage own preferences" on user_preferences
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### Migration — existing installs (multiple lists + 12 categories)

If you already have the older single-list schema, run this **once** in the Supabase SQL editor.
It is additive and safe to run on live data.

```sql
-- 1. Named lists
create table if not exists shopping_lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  name       text not null,
  is_default boolean default false,
  created_at timestamptz default now()
);
alter table shopping_lists enable row level security;
create policy "Users manage own shopping lists" on shopping_lists
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists shopping_lists_user_idx on shopping_lists(user_id);

-- 2. Item columns
alter table shopping_list add column if not exists list_id uuid
  references shopping_lists(id) on delete cascade;
alter table shopping_list add column if not exists amount text;
create index if not exists shopping_list_list_idx on shopping_list(list_id);

-- 3. One default list per user who already has items, then assign existing items
insert into shopping_lists (user_id, name, is_default)
select distinct user_id, 'My List', true from shopping_list
where user_id not in (select user_id from shopping_lists);

update shopping_list sl
set list_id = l.id
from shopping_lists l
where l.user_id = sl.user_id and l.is_default = true and sl.list_id is null;

-- 4. Split the old "amount · recipe" hack into the new amount column
update shopping_list
set amount      = split_part(recipe_name, ' · ', 1),
    recipe_name = split_part(recipe_name, ' · ', 2)
where recipe_name like '% · %';

-- 5. Remap the 7 old categories to the new 12 (Produce → Vegetables is intentionally
--    coarse; the app re-categorizes live items on load and remembers your corrections)
update shopping_list set category = case category
  when 'Meat'    then 'Protein'
  when 'Dairy'   then 'Refrigerated'
  when 'Bakery'  then 'Pantry'
  when 'Produce' then 'Vegetables'
  else category
end
where category in ('Meat','Dairy','Bakery','Produce');

-- 6. Per-user category overrides
create table if not exists ingredient_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  ingredient text not null,
  category   text not null,
  updated_at timestamptz default now(),
  unique (user_id, ingredient)
);
alter table ingredient_categories enable row level security;
create policy "Users manage own ingredient categories" on ingredient_categories
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 7. Remember the active list per user (syncs across devices)
alter table user_preferences add column if not exists active_list_id uuid
  references shopping_lists(id) on delete set null;
```

### Supabase Storage

Create a **public** storage bucket named `recipe-photos`:

1. Go to **Storage** in your Supabase dashboard
2. Click **New bucket**
3. Name it `recipe-photos`
4. Toggle **Public bucket** on
5. Save

Recipe photos are stored at the path `{user_id}/{recipe_id}-{timestamp}.{ext}`.

---

## Environment Variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key

VITE_GROQ_API_KEY=your-groq-api-key
VITE_GEMINI_API_KEY=your-gemini-api-key
```

| Variable | Where to get it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API |
| `VITE_GROQ_API_KEY` | [console.groq.com](https://console.groq.com) → API Keys |
| `VITE_GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → Get API key |

> All four variables are required. Groq handles chat, recipe generation, text/URL extraction, and ingredient categorization. Gemini handles image and PDF recipe extraction only.

---

## Running Locally

```bash
# 1. Clone the repo
git clone https://github.com/your-username/cookbook-app.git
cd cookbook-app

# 2. Install dependencies
npm install

# 3. Create your .env file (see Environment Variables above)

# 4. Set up Supabase
#    - Create a new project at supabase.com
#    - Run all the SQL from the "Supabase Tables" section above in the SQL editor
#    - Create the recipe-photos storage bucket (public)
#    - Copy your project URL and anon key into .env

# 5. Start the dev server
npm run dev
```

The app runs at `http://localhost:5173`.

### Build for production

```bash
npm run build
npm run preview   # preview the production build locally
```

The `dist/` folder is ready to deploy to Vercel, Netlify, Cloudflare Pages, or any static host.

---

## AI Architecture

The app uses two AI providers with a clear division of responsibility:

```
User message → Groq (Llama 3.3 70B)
  ├── Chat responses
  ├── Recipe generation
  ├── Recipe extraction from URLs and text
  └── Ingredient categorization

File upload → Gemini 2.0 Flash
  ├── Recipe extraction from photos
  └── Recipe extraction from PDFs
```

The chat system prompt is built fresh for each message and includes:
- The user's dietary restrictions (always)
- Cookbook recipe titles + ingredients (only when the message is food/recipe-related)
- Shopping history grouped by date (only when the message mentions shopping or buying)

This context-filtering means most messages only send a small system prompt, keeping responses fast.

The AI can embed action tags in its responses to write directly to the database:

```
<action>{"type":"add_meal","name":"Salmon","date":"2026-06-11","slot":"dinner"}</action>
<action>{"type":"add_shopping","items":[{"ingredient":"eggs","category":"Meat"}]}</action>
```

These are executed silently in `sendMessage` before the reply is displayed, then stripped from the stored text. The AI's surrounding prose serves as the user-visible confirmation.
