import { useState, useEffect } from 'react'
import { LogOut, Loader2, Key, X } from 'lucide-react'
import { useAuth } from './hooks/useAuth'
import { Auth } from './components/Auth'
import { Dashboard } from './components/Dashboard'

function App() {
  const { user, loading, signIn, signUp, signOut, resetPasswordRequest, updatePassword } = useAuth()
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)

  // Detect password recovery session on mount and hash changes
  useEffect(() => {
    const checkRecovery = () => {
      const hash = window.location.hash
      if (hash && hash.includes('type=recovery')) {
        setIsPasswordRecovery(true)
      }
    }

    checkRecovery()
    window.addEventListener('hashchange', checkRecovery)
    return () => window.removeEventListener('hashchange', checkRecovery)
  }, [])

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters')
      return
    }

    const { error } = await updatePassword(newPassword)
    if (error) {
      setPasswordError(error.message)
    } else {
      setPasswordSuccess('Password updated successfully!')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => {
        setShowChangePassword(false)
        setPasswordSuccess('')
      }, 2000)
    }
  }

  const handlePasswordRecoveryComplete = () => {
    // Clear recovery state after successful password reset from email link
    setIsPasswordRecovery(false)
    window.location.hash = ''
  }

  // Show loading spinner while checking auth state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  // Show auth screen if not logged in OR if this is a password recovery session
  if (!user || isPasswordRecovery) {
    return (
      <Auth
        onSignIn={signIn}
        onSignUp={signUp}
        onResetPasswordRequest={resetPasswordRequest}
        onUpdatePassword={updatePassword}
        onRecoveryComplete={handlePasswordRecoveryComplete}
      />
    )
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
              <div>
                <span className="font-semibold text-primary">
                  Medical Lecture Study Assistant
                </span>
                <span className="ml-2 text-xs text-secondary">v3.75</span>
              </div>
            </div>

            {/* User menu */}
            <div className="flex items-center gap-4">
              <span className="text-sm text-secondary">{user.email}</span>
              <button
                onClick={() => setShowChangePassword(true)}
                className="flex items-center gap-2 px-3 py-2 text-secondary hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Key className="w-4 h-4" />
                <span className="text-sm">Change Password</span>
              </button>
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

      {/* Change Password Modal */}
      {showChangePassword && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl p-6 max-w-md w-full shadow-xl border border-divider">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-primary">Change Password</h2>
              <button
                onClick={() => {
                  setShowChangePassword(false)
                  setPasswordError('')
                  setPasswordSuccess('')
                  setNewPassword('')
                  setConfirmPassword('')
                }}
                className="text-secondary hover:text-primary"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-primary mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-background border border-divider rounded-lg focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors text-primary"
                  placeholder="Enter new password"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-primary mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-background border border-divider rounded-lg focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors text-primary"
                  placeholder="Confirm new password"
                  required
                />
              </div>

              {passwordError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                  {passwordError}
                </div>
              )}

              {passwordSuccess && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-600 text-sm">
                  {passwordSuccess}
                </div>
              )}

              <button
                type="submit"
                className="w-full px-4 py-2 bg-accent hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
              >
                Update Password
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-7xl mx-auto">
        <Dashboard user={user} />
      </main>
    </div>
  )
}

export default App
