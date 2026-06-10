import { useState, useRef } from 'react'
import IngredientChecklist from './IngredientChecklist'

export default function RecipeFullView({
  recipe,
  onClose,
  onSave,
  onDelete,
  onEdit,
  onPhotoChange,
  onPhotoDelete,
  showSaveButton = false,
  showDeleteButton = false,
}) {
  const [showChecklist, setShowChecklist] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoDeleting, setPhotoDeleting] = useState(false)
  const fileInputRef = useRef(null)

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

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file || !onPhotoChange) return
    setPhotoUploading(true)
    try {
      await onPhotoChange(file)
    } finally {
      setPhotoUploading(false)
      e.target.value = ''
    }
  }

  async function handlePhotoDelete() {
    if (!onPhotoDelete) return
    setPhotoDeleting(true)
    try {
      await onPhotoDelete()
    } finally {
      setPhotoDeleting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>

        {/* Recipe photo */}
        {recipe.source_image && (
          <div className="recipe-photo-header">
            <img src={recipe.source_image} alt={recipe.title} className="recipe-photo-img" />
            <div className="recipe-photo-actions">
              {onPhotoChange && (
                <button
                  className="recipe-photo-change-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photoUploading || photoDeleting}
                >
                  {photoUploading ? '…' : '📷 Change'}
                </button>
              )}
              {onPhotoDelete && (
                <button
                  className="recipe-photo-delete-btn"
                  onClick={handlePhotoDelete}
                  disabled={photoUploading || photoDeleting}
                >
                  {photoDeleting ? '…' : '🗑 Remove'}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="recipe-full">
          {/* Add photo button when no photo exists */}
          {!recipe.source_image && onPhotoChange && (
            <button
              className="btn-ghost"
              style={{ marginBottom: 12, width: '100%' }}
              onClick={() => fileInputRef.current?.click()}
              disabled={photoUploading}
            >
              {photoUploading ? 'Uploading…' : '📷 Add Photo'}
            </button>
          )}

          {/* Hidden file input */}
          {onPhotoChange && (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          )}

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
