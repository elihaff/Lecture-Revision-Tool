import { useState, useEffect, lazy, Suspense } from 'react'
import { LogOut, Loader2 } from 'lucide-react'
import { useAuth } from './hooks/useAuth'
import { Auth } from './components/Auth'
import { supabase } from './lib/supabase'
import { loadPersistedSession } from './lib/studySessionPersistence'
import { ToastProvider } from './components/Toast'

const Dashboard = lazy(() => import('./components/Dashboard').then((m) => ({ default: m.Dashboard })))
const WheelDashboard = lazy(() => import('./components/WheelDashboard').then((m) => ({ default: m.WheelDashboard })))
const StatsView = lazy(() => import('./components/StatsView').then((m) => ({ default: m.StatsView })))
const SettingsView = lazy(() => import('./components/SettingsView').then((m) => ({ default: m.SettingsView })))
const CustomStudyView = lazy(() => import('./components/CustomStudyView').then((m) => ({ default: m.CustomStudyView })))
const GlobalReviewSession = lazy(() => import('./components/GlobalReviewSession').then((m) => ({ default: m.GlobalReviewSession })))
const SessionLogView = lazy(() => import('./components/SessionLogView').then((m) => ({ default: m.SessionLogView })))
const FlashcardReviewView = lazy(() => import('./components/FlashcardReviewView').then((m) => ({ default: m.FlashcardReviewView })))

function ViewLoader() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-accent animate-spin" />
    </div>
  )
}

function App() {
  const { user, loading, signIn, signUp, signOut, resetPasswordRequest, updatePassword, updateDisplayName } = useAuth()
  const [currentView, setCurrentView] = useState('home') // 'home' | 'modules' | 'review' | 'custom-study' | 'session-log' | 'stats' | 'settings' | 'lecture-review'
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [resumeLectureContext, setResumeLectureContext] = useState(null)
  const [resumeTargetView, setResumeTargetView] = useState(null)

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

  const handlePasswordRecoveryComplete = () => {
    // Clear recovery state after successful password reset from email link
    setIsPasswordRecovery(false)
    window.location.hash = ''
  }

  const handleResumeFromSessionLog = async (row) => {
    if (!row || !row.source_type) return
    if (row.source_type === 'global') {
      // Always route into the session view from Resume.
      // If persisted state exists, auto-resume uses it; otherwise the view falls back safely.
      loadPersistedSession({ userId: user.id, mode: 'review-global', scope: 'global' })
      setResumeTargetView('review')
      setCurrentView('review')
      return
    }
    if (row.source_type === 'custom') {
      loadPersistedSession({ userId: user.id, mode: 'custom-study', scope: 'custom-study' })
      setResumeTargetView('custom-study')
      setCurrentView('custom-study')
      return
    }
    if (row.source_type === 'lecture' && row.lecture_id) {
      loadPersistedSession({ userId: user.id, mode: 'learn-lecture', scope: `lecture:${row.lecture_id}` })
      const { data: lecture, error: lectureError } = await supabase
        .from('lectures')
        .select('id, title, module_id')
        .eq('id', row.lecture_id)
        .single()
      if (lectureError || !lecture) {
        setCurrentView('modules')
        return
      }

      let module = null
      if (lecture.module_id) {
        const { data: moduleRow } = await supabase
          .from('modules')
          .select('id, name, abbreviation, color')
          .eq('id', lecture.module_id)
          .single()
        module = moduleRow || null
      }

      setResumeLectureContext({ lecture, module })
      setResumeTargetView('lecture-review')
      setCurrentView('lecture-review')
      return
    }
    setResumeTargetView(null)
    setCurrentView('home')
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
    <ToastProvider>
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-surface border-b border-divider">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo - clickable to go home */}
            <button
              onClick={() => setCurrentView('home')}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            >
              <span className="text-2xl">🧠</span>
              <div>
                <span className="font-semibold text-primary">
                  Eli's Revision Tool
                </span>
                <span className="ml-2 text-xs text-secondary">v6.51</span>
              </div>
            </button>

            {/* User menu */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-secondary px-2">{user.email}</span>
              <button
                onClick={signOut}
                className="p-2 text-secondary hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto">
        <Suspense fallback={<ViewLoader />}>
          {currentView === 'home' && (
            <WheelDashboard
              user={user}
              onNavigate={(view) => setCurrentView(view)}
            />
          )}
          {currentView === 'modules' && (
            <Dashboard
              user={user}
              onBack={() => setCurrentView('home')}
            />
          )}
          {currentView === 'review' && (
            <GlobalReviewSession
              user={user}
              autoResumeFromLog={resumeTargetView === 'review'}
              onAutoResumeHandled={() => setResumeTargetView(null)}
              onBack={() => setCurrentView('home')}
            />
          )}
          {currentView === 'custom-study' && (
            <CustomStudyView
              user={user}
              autoResumeFromLog={resumeTargetView === 'custom-study'}
              onAutoResumeHandled={() => setResumeTargetView(null)}
              onBack={() => setCurrentView('home')}
            />
          )}
          {currentView === 'stats' && (
            <StatsView
              user={user}
              onBack={() => setCurrentView('home')}
            />
          )}
          {currentView === 'session-log' && (
            <SessionLogView
              user={user}
              onBack={(action) => {
                if (action?.action === 'resume') {
                  handleResumeFromSessionLog(action.row)
                  return
                }
                setCurrentView('home')
              }}
            />
          )}
          {currentView === 'lecture-review' && resumeLectureContext?.lecture && (
            <FlashcardReviewView
              lecture={resumeLectureContext.lecture}
              module={resumeLectureContext.module}
              user={user}
              examDate={null}
              autoResumeFromLog={resumeTargetView === 'lecture-review'}
              onAutoResumeHandled={() => setResumeTargetView(null)}
              onBack={() => {
                setResumeLectureContext(null)
                setResumeTargetView(null)
                setCurrentView('session-log')
              }}
            />
          )}
          {currentView === 'settings' && (
            <SettingsView
              user={user}
              onBack={() => setCurrentView('home')}
              onUpdatePassword={updatePassword}
              onUpdateDisplayName={updateDisplayName}
            />
          )}
        </Suspense>
      </main>
    </div>
    </ToastProvider>
  )
}

export default App
