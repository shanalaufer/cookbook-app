import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function Settings() {
  const { user, preferences, updatePreferences, signOut } = useAuth()
  const navigate = useNavigate()
  const [restrictions, setRestrictions] = useState(preferences.dietary_restrictions ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Sync textarea when preferences finish loading from Supabase
  useEffect(() => {
    setRestrictions(preferences.dietary_restrictions ?? '')
  }, [preferences.dietary_restrictions])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setSaveError('')
    try {
      await updatePreferences({ dietary_restrictions: restrictions })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setSaveError(e.message || 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div className="page">
      <div className="page-header" style={{ paddingRight: 0 }}>
        <button className="settings-back-btn" onClick={() => navigate(-1)}>← Back</button>
        <h1 style={{ marginTop: 6 }}>Settings</h1>
      </div>

      <div className="settings-section">
        <div className="settings-label">Account</div>
        <div className="settings-card">
          <div className="settings-row">
            <span>Email</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>{user.email}</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">Dietary Restrictions</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
          These are sent with every AI request automatically.
        </p>
        <textarea
          className="input-field"
          value={restrictions}
          onChange={e => setRestrictions(e.target.value)}
          placeholder="e.g. kosher — no pork, no shellfish, no mixing meat and dairy"
          rows={4}
        />
        {saved     && <div className="success-banner" style={{ marginTop: 8 }}>✓ Saved</div>}
        {saveError && <div className="error-banner"   style={{ marginTop: 8 }}>{saveError}</div>}
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ marginTop: 12 }}
        >
          {saving ? 'Saving…' : 'Save Restrictions'}
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-label">About</div>
        <div className="settings-card">
          <div className="settings-row">
            <span>App version</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>1.0.0</span>
          </div>
          <div className="settings-row">
            <span>AI model</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>Gemini 3 Flash Preview</span>
          </div>
        </div>
      </div>

      <button className="btn-danger" onClick={handleSignOut} style={{ marginTop: 8 }}>
        Sign Out
      </button>
    </div>
  )
}
