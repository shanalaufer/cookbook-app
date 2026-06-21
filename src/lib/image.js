import { supabase } from './supabase'

const BUCKET = 'recipe-photos'

// Resize an image File to a JPEG and return base64 (no data: prefix).
// Routing through a canvas normalizes iOS HEIC and oversized phone photos
// into a web-displayable format — raw HEIC won't render in most browsers.
export function resizeImageToJpegBase64(file, maxSide = 800) {
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
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.onerror = reject
    img.src = url
  })
}

// base64 JPEG → bytes → Storage. The atob + Uint8Array path is reliable on
// iOS Safari (no Blob/File constructor needed). Returns the public URL.
export async function uploadRecipePhoto(base64Jpeg, userId) {
  const binary = atob(base64Jpeg)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const path = `${userId}/${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

// Convenience: File → resized JPEG → Storage → public URL.
export async function uploadRecipePhotoFile(file, userId) {
  const b64 = await resizeImageToJpegBase64(file)
  return uploadRecipePhoto(b64, userId)
}

// Remove a previously-uploaded photo from Storage given its public URL.
// No-op for external/auto-imported URLs (e.g. og:image) not in our bucket.
export async function deleteRecipePhotoByUrl(url) {
  if (!url) return
  const marker = `/${BUCKET}/`
  if (!url.includes(marker)) return
  const path = url.split(marker)[1].split('?')[0]
  if (path) await supabase.storage.from(BUCKET).remove([path])
}
