import { NavLink } from 'react-router-dom'

const tabs = [
  { path: '/chat',     icon: '🤖', label: 'AI Chat'  },
  { path: '/cookbook', icon: '⭐', label: 'Cookbook'  },
  { path: '/shopping', icon: '🛒', label: 'Shopping'  },
  { path: '/planner',  icon: '📅', label: 'Planner'   },
]

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {tabs.map(tab => (
        <NavLink
          key={tab.path}
          to={tab.path}
          className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
        >
          <span className="nav-icon">{tab.icon}</span>
          <span className="nav-label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
