import { useState, useEffect } from 'react'
import { LogIn, UserPlus, Mail, Lock, AlertCircle } from 'lucide-react'

export function Auth({ onSignIn, onSignUp, onResetPasswordRequest, onUpdatePassword, onRecoveryComplete }) {
  const [isLogin, setIsLogin] = useState(true)
  const [isForgotPassword, setIsForgotPassword] = useState(false)
  const [isResettingPassword, setIsResettingPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  // Check if URL contains recovery token
  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.includes('type=recovery')) {
      setIsResettingPassword(true)
      setIsForgotPassword(false)
      setIsLogin(false)
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      if (isResettingPassword) {
        // Handle password reset
        if (newPassword !== confirmPassword) {
          throw new Error('Passwords do not match')
        }
        if (newPassword.length < 6) {
          throw new Error('Password must be at least 6 characters')
        }
        const { error } = await onUpdatePassword(newPassword)
        if (error) throw error
        setMessage('Password updated successfully! Redirecting...')
        setTimeout(() => {
          if (onRecoveryComplete) {
            onRecoveryComplete()
          }
          window.location.hash = ''
          window.location.reload()
        }, 2000)
      } else if (isForgotPassword) {
        // Handle forgot password request
        const { error } = await onResetPasswordRequest(email)
        if (error) throw error
        setMessage('Check your email for a password reset link!')
        setTimeout(() => {
          setIsForgotPassword(false)
          setIsLogin(true)
        }, 3000)
      } else if (isLogin) {
        // Handle login
        const { error } = await onSignIn(email, password)
        if (error) throw error
      } else {
        // Handle signup
        const { error } = await onSignUp(email, password)
        if (error) throw error
        setMessage('Check your email for a confirmation link!')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🧠</div>
          <h1 className="text-2xl font-bold text-primary mb-2">
            Medical Lecture Study Assistant
          </h1>
          <p className="text-secondary">
            {isResettingPassword
              ? 'Create a new password'
              : isForgotPassword
              ? 'Reset your password'
              : isLogin
              ? 'Sign in to your account'
              : 'Create a new account'}
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-surface rounded-2xl p-8 shadow-lg border border-divider">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email - show only if not resetting password */}
            {!isResettingPassword && (
              <div>
                <label className="block text-sm font-medium text-primary mb-2">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-divider rounded-xl text-primary placeholder-secondary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* Password - show only if login or signup */}
            {!isForgotPassword && !isResettingPassword && (
              <div>
                <label className="block text-sm font-medium text-primary mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-divider rounded-xl text-primary placeholder-secondary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* New Password - show only if resetting */}
            {isResettingPassword && (
              <>
                <div>
                  <label className="block text-sm font-medium text-primary mb-2">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary" />
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-divider rounded-xl text-primary placeholder-secondary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-primary mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary" />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-divider rounded-xl text-primary placeholder-secondary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-error text-sm">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Success Message */}
            {message && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-success text-sm">
                {message}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-accent hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-colors"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : isResettingPassword ? (
                <>
                  <Lock className="w-5 h-5" />
                  Update Password
                </>
              ) : isForgotPassword ? (
                <>
                  <Mail className="w-5 h-5" />
                  Send Reset Link
                </>
              ) : isLogin ? (
                <>
                  <LogIn className="w-5 h-5" />
                  Sign In
                </>
              ) : (
                <>
                  <UserPlus className="w-5 h-5" />
                  Sign Up
                </>
              )}
            </button>
          </form>

          {/* Forgot Password Link */}
          {!isResettingPassword && !isForgotPassword && isLogin && (
            <div className="mt-4 text-center text-sm">
              <button
                onClick={() => {
                  setIsForgotPassword(true)
                  setError(null)
                  setMessage(null)
                }}
                className="text-accent hover:text-blue-600 font-medium"
              >
                Forgot password?
              </button>
            </div>
          )}

          {/* Toggle */}
          <div className="mt-6 text-center text-sm text-secondary">
            {isResettingPassword ? (
              <div className="text-xs text-secondary">
                After updating your password, you'll be redirected to sign in.
              </div>
            ) : isForgotPassword ? (
              <>
                Remember your password?{' '}
                <button
                  onClick={() => {
                    setIsForgotPassword(false)
                    setIsLogin(true)
                    setError(null)
                    setMessage(null)
                  }}
                  className="text-accent hover:text-blue-600 font-medium"
                >
                  Sign in
                </button>
              </>
            ) : isLogin ? (
              <>
                Don't have an account?{' '}
                <button
                  onClick={() => {
                    setIsLogin(false)
                    setError(null)
                    setMessage(null)
                  }}
                  className="text-accent hover:text-blue-600 font-medium"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  onClick={() => {
                    setIsLogin(true)
                    setError(null)
                    setMessage(null)
                  }}
                  className="text-accent hover:text-blue-600 font-medium"
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
