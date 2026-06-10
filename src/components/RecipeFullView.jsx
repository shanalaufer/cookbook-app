import { useState } from 'react'
import IngredientChecklist from './IngredientChecklist'

export default function RecipeFullView({
  recipe,
  onClose,
  onSave,
  onDelete,
  onEdit,
  showSaveButton = false,
  showDeleteButton = false,
}) {
  const [showChecklist, setShowChecklist] = useState(false)

  if (showChecklist) {
    return (
      <IngredientChecklist
        ingredients={recipe.ingredients ?? []}
        recipeName={recipe.title}
        recipeId={recipe.id ?? null}
        onDone={() => { setShowChecklist(false); onClose() }}
        onCancel={() => setShowChecklist(false)}
      />
    )
  }

  const steps = (recipe.instructions ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>

        <div className="recipe-full">
          <h2>{recipe.title}</h2>
          <p className="recipe-description">{recipe.description}</p>

          {recipe.source_url && (
            <a
              href={recipe.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="source-link"
            >
              View original source ↗
            </a>
          )}

          <section>
            <h3>Ingredients</h3>
            <ul className="ingredients-list">
              {(recipe.ingredients ?? []).map((ing, i) => (
                <li key={i}>{ing}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Instructions</h3>
            <div className="instructions">
              {steps.map((step, i) => (
                <p key={i}>{step}</p>
              ))}
            </div>
          </section>

          <div className="recipe-actions">
            {showSaveButton && onSave && (
              <button className="btn-primary" onClick={onSave}>
                ⭐ Save to Cookbook
              </button>
            )}
            <button className="btn-secondary" onClick={() => setShowChecklist(true)}>
              🛒 Add to Shopping List
            </button>
            {onEdit && (
              <button className="btn-ghost" onClick={onEdit}>
                ✏️ Edit Recipe
              </button>
            )}
            {showDeleteButton && onDelete && (
              <button className="btn-danger" onClick={onDelete}>
                🗑 Delete Recipe
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
