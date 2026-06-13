import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import * as pdfjs from 'pdfjs-dist'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  extractRecipeFromText,
  extractRecipeFromUrl,
  extractRecipeFromImage,
} from '../lib/ai'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

async function extractPdfText(file) {
  const arrayBuffer = await readAsArrayBuffer(file)
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map(item => item.str).join(' '))
  }
  return pages.join('\n')
}

const METHODS = [
  { id: 'text',  icon: '📝', label: 'Paste Text'  },
  { id: 'photo', icon: '📷', label: 'Photo'        },
  { id: 'pdf',   icon: '📄', label: 'PDF'          },
  { id: 'url',   icon: '🔗', label: 'URL / Link'   },
]

function resizeImage(file, maxSide = 800) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.naturalWidth  * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      resolve({ data: dataUrl.split(',')[1], mimeType: 'image/jpeg' })
    }
    img.onerror = reject
    img.src = url
  })
}

async function fetchPageContent(url) {
  const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`
  const res  = await fetch(proxy)
  const html = await res.text()
  const doc  = new DOMParser().parseFromString(html, 'text/html')

  // Extract cover image before stripping tags
  let imageUrl =
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ??
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ??
    null

  // Resolve relative URLs
  if (imageUrl && !imageUrl.startsWith('http')) {
    try { imageUrl = new URL(imageUrl, url).href } catch { imageUrl = null }
  }

  doc.querySelectorAll('script,style,nav,footer,header,aside').forEach(el => el.remove())
  return { text: doc.body?.textContent ?? '', imageUrl }
}

// ── Drop zone ────────────────────────────────────────────
function DropZone({ method, file, onFile, onClear }) {
  const fileRef   = useRef()
  const [dragging, setDragging] = useState(false)

  // Paste support (images only)
  useEffect(() => {
    if (method !== 'photo') return
    function onPaste(e) {
      for (const item of e.clipboardData?.items ?? []) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile()
          if (f) onFile(f)
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [method, onFile])

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  const accept = method === 'photo' ? 'image/*' : 'application/pdf'
  const icon   = method === 'photo' ? '📷' : '📄'
  const hint   = method === 'photo' ? 'JPG, PNG, HEIC… or paste from clipboard' : 'PDF files'
  const label  = method === 'photo' ? 'Tap to choose, paste, or drag & drop' : 'Tap to choose or drag & drop'

  return (
    <div
      className={`drop-zone${dragging ? ' dragging' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => fileRef.current?.click()}
    >
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        hidden
        onChange={e => { const f = e.target.files[0]; if (f) onFile(f) }}
      />

      {file ? (
        <div className="drop-zone-file">
          <span>📎 {file.name}</span>
          <button
            className="drop-zone-clear"
            onClick={e => { e.stopPropagation(); onClear() }}
          >×</button>
        </div>
      ) : (
        <>
          <div className="drop-zone-icon">{icon}</div>
          <p className="drop-zone-label">{label}</p>
          <p className="drop-zone-hint">{hint}</p>
        </>
      )}
    </div>
  )
}

// ── Main modal ───────────────────────────────────────────
export default function AddRecipeModal({ onClose, onSaved }) {
  const { user, preferences } = useAuth()
  const [method,           setMethod]           = useState(null)
  const [input,            setInput]            = useState('')
  const [droppedFile,      setDroppedFile]      = useState(null)
  const [loading,          setLoading]          = useState(false)
  const [error,            setError]            = useState('')
  const [preview,          setPreview]          = useState(null)
  const [showAllIngredients, setShowAllIngredients] = useState(false)

  function resetMethod() {
    setMethod(null); setInput(''); setError(''); setDroppedFile(null)
  }

  async function handleExtract() {
    setError('')

    if (method === 'url' && /instagram\.com|instagr\.am/i.test(input)) {
      setError("Instagram links can't be imported directly — screenshot the recipe and upload it as a photo instead!")
      return
    }

    setLoading(true)
    try {
      const dr = preferences.dietary_restrictions
      let recipe

      if (method === 'text') {
        recipe = await extractRecipeFromText(input, dr)

      } else if (method === 'url') {
        const { text, imageUrl } = await fetchPageContent(input)
        recipe = await extractRecipeFromUrl(input, text, dr)
        recipe._sourceUrl   = input
        recipe._sourceImage = imageUrl ?? null

      } else if (method === 'photo') {
        const file = droppedFile
        if (!file) { setError('Please select or paste an image.'); return }
        const { data: b64, mimeType } = await resizeImage(file)
        recipe = await extractRecipeFromImage(b64, mimeType, dr)

      } else if (method === 'pdf') {
        const file = droppedFile
        if (!file) { setError('Please select a PDF.'); return }
        const pdfText = await extractPdfText(file)
        recipe = await extractRecipeFromText(pdfText, dr)
      }

      setPreview(recipe)
      setShowAllIngredients(false)
    } catch (e) {
      setError(e.message || 'Extraction failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    try {
      const sourceTypeMap = { text: 'manual', photo: 'photo', pdf: 'pdf', url: 'url' }
      const { error: err } = await supabase.from('recipes').insert({
        user_id:      user.id,
        title:        preview.title,
        description:  preview.description ?? '',
        ingredients:  preview.ingredients ?? [],
        instructions: preview.instructions ?? '',
        source_type:  sourceTypeMap[method] ?? 'manual',
        source_url:   preview._sourceUrl   ?? null,
        source_image: preview._sourceImage ?? null,
      })
      if (err) throw err
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Preview step ────────────────────────────────────────
  if (preview) {
    const total   = preview.ingredients?.length ?? 0
    const visible = showAllIngredients ? total : Math.min(6, total)
    const hidden  = total - visible

    return createPortal(
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
          <button className="modal-close" onClick={onClose}>✕</button>
          <h3 className="modal-title">Review Recipe</h3>

          <div className="preview-recipe">
            {preview._sourceImage && (
              <img
                src={preview._sourceImage}
                alt={preview.title}
                className="preview-cover"
              />
            )}
            <h4>{preview.title}</h4>
            <p className="preview-desc">{preview.description}</p>
            <div className="preview-section">
              <strong>Ingredients ({total})</strong>
              <ul>
                {(preview.ingredients ?? []).slice(0, visible).map((ing, i) => (
                  <li key={i}>{ing}</li>
                ))}
              </ul>
              {hidden > 0 && (
                <button
                  className="show-more-ingredients-btn"
                  onClick={() => setShowAllIngredients(true)}
                >
                  + {hidden} more ingredient{hidden !== 1 ? 's' : ''}
                </button>
              )}
            </div>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="checklist-actions" style={{ marginTop: 20 }}>
            <button className="btn-ghost" onClick={() => { setPreview(null); setShowAllIngredients(false) }}>
              Back
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={loading}>
              {loading ? 'Saving…' : '⭐ Save to Cookbook'}
            </button>
          </div>
        </div>
      </div>,
      document.body
    )
  }

  // ── Input step ──────────────────────────────────────────
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h3 className="modal-title">Add Recipe</h3>

        {!method ? (
          <div className="add-options">
            {METHODS.map(m => (
              <button key={m.id} className="add-option-btn" onClick={() => setMethod(m.id)}>
                <span className="icon">{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div>
            <button className="back-btn" onClick={resetMethod}>← Back</button>

            {method === 'text' && (
              <textarea
                className="input-field"
                placeholder="Paste recipe text here…"
                value={input}
                onChange={e => setInput(e.target.value)}
                style={{ marginTop: 12, minHeight: 160 }}
              />
            )}

            {method === 'url' && (
              <input
                className="input-field"
                type="url"
                placeholder="https://example.com/recipe"
                value={input}
                onChange={e => setInput(e.target.value)}
                style={{ marginTop: 12 }}
              />
            )}

            {(method === 'photo' || method === 'pdf') && (
              <div style={{ marginTop: 12 }}>
                <DropZone
                  method={method}
                  file={droppedFile}
                  onFile={setDroppedFile}
                  onClear={() => setDroppedFile(null)}
                />
              </div>
            )}

            {error && <div className="error-banner" style={{ marginTop: 12 }}>{error}</div>}

            <button
              className="btn-primary"
              style={{ marginTop: 16 }}
              onClick={handleExtract}
              disabled={
                loading ||
                (method === 'text'  && !input.trim()) ||
                (method === 'url'   && !input.trim()) ||
                (method === 'photo' && !droppedFile)  ||
                (method === 'pdf'   && !droppedFile)
              }
            >
              {loading ? 'Extracting…' : 'Extract Recipe'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
