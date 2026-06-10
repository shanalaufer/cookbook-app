import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Auth from './pages/Auth'
import Cookbook from './pages/Cookbook'
import ShoppingList from './pages/ShoppingList'
import MealPlanner from './pages/MealPlanner'
import AIChat from './pages/AIChat'
import Settings from './pages/Settings'
import BottomNav from './components/BottomNav'

function GearButton() {
  const { pathname } = useLocation()
  if (pathname === '/settings') return null
  return (
    <Link to="/settings" className="gear-btn" aria-label="Settings">⚙️</Link>
  )
}

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="loading-screen">
        <div style={{ fontSize: 52 }}>🍳</div>
        <p style={{ color: 'var(--text-muted)', marginTop: 12 }}>Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Auth />} />
      </Routes>
    )
  }

  return (
    <div className="app-container">
      <div className="page-content">
        <GearButton />
        <Routes>
          <Route path="/"         element={<Navigate to="/chat" replace />} />
          <Route path="/chat"     element={<AIChat />} />
          <Route path="/cookbook" element={<Cookbook />} />
          <Route path="/shopping" element={<ShoppingList />} />
          <Route path="/planner"  element={<MealPlanner />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*"         element={<Navigate to="/chat" replace />} />
        </Routes>
      </div>
      <BottomNav />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
