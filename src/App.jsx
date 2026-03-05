import { LogOut, Loader2 } from 'lucide-react'
import { useAuth } from './hooks/useAuth'
import { Auth } from './components/Auth'
import { Dashboard } from './components/Dashboard'

function App() {
  const { user, loading, signIn, signUp, signOut } = useAuth()

  // Show loading spinner while checking auth state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  // Show auth screen if not logged in
  if (!user) {
    return <Auth onSignIn={signIn} onSignUp={signUp} />
  }

  // Show dashboard if logged in
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface border-b border-divider">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <span className="text-2xl">🧠</span>
              <span className="font-semibold text-primary">
                Medical Lecture Study Assistant
              </span>
            </div>

            {/* User menu */}
            <div className="flex items-center gap-4">
              <span className="text-sm text-secondary">{user.email}</span>
              <button
                onClick={signOut}
                className="flex items-center gap-2 px-3 py-2 text-secondary hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="text-sm">Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto">
        <Dashboard user={user} />
      </main>
    </div>
  )
}

export default App
