// Polyfills for iOS < 15.4 (needed by pdfjs-dist v6)
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    value(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return (n < 0 || n >= this.length) ? undefined : this[n] },
    writable: true, configurable: true,
  })
}
if (!String.prototype.at) {
  Object.defineProperty(String.prototype, 'at', {
    value(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return (n < 0 || n >= this.length) ? undefined : this[n] },
    writable: true, configurable: true,
  })
}
if (!Object.hasOwn) {
  Object.hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
}
if (typeof structuredClone === 'undefined') {
  globalThis.structuredClone = obj => JSON.parse(JSON.stringify(obj))
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
