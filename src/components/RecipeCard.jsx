const SOURCE_TAGS = {
  ai:     { label: 'AI Generated', cls: 'tag-purple' },
  photo:  { label: 'From Photo',   cls: 'tag-blue'   },
  pdf:    { label: 'From PDF',     cls: 'tag-red'     },
  url:    { label: 'From Link',    cls: 'tag-green'   },
  manual: { label: 'Manual',       cls: 'tag-gray'    },
}

export default function RecipeCard({ recipe, onClick }) {
  const tag = SOURCE_TAGS[recipe.source_type] ?? SOURCE_TAGS.manual
  return (
    <div className="recipe-card" onClick={onClick}>
      {recipe.source_image && (
        <div className="recipe-card-image">
          <img src={recipe.source_image} alt={recipe.title} />
        </div>
      )}
      <div className="recipe-card-body">
        <span className={`source-tag ${tag.cls}`}>{tag.label}</span>
        <h3>{recipe.title}</h3>
        <p>{recipe.description}</p>
      </div>
    </div>
  )
}
