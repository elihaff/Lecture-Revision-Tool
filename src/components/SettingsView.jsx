import { useState, useEffect } from 'react'
import { ArrowLeft, Calendar, User, Key, Check, RotateCcw, AlertTriangle, Loader2, Shield } from 'lucide-react'
import { getUserSettings, setExamDate } from '../lib/userSettingsService'
import { previewResetCount, resetFlashcardProgress } from '../lib/flashcardService'
import { clearPersistedSession } from '../lib/studySessionPersistence'
import { supabase } from '../lib/supabase'

export function SettingsView({ user, onBack, onUpdatePassword, onUpdateDisplayName }) {
  // Exam date state
  const [examDate, setExamDateState] = useState('')
  const [examLoading, setExamLoading] = useState(true)
  const [examSaving, setExamSaving] = useState(false)

  // Display name state
  const [displayName, setDisplayName] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameSuccess, setNameSuccess] = useState(false)

  // Password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  // Reset progress state
  const [resetScope, setResetScope] = useState('all') // 'all' | 'modules' | 'lectures'
  const [modules, setModules] = useState([])
  const [lectures, setLectures] = useState([])
  const [resetFilterLoading, setResetFilterLoading] = useState(true)
  const [selectedModuleIds, setSelectedModuleIds] = useState([])
  const [selectedLectureIds, setSelectedLectureIds] = useState([])
  const [resetPreviewCount, setResetPreviewCount] = useState(0)
  const [resetPreviewLoading, setResetPreviewLoading] = useState(false)
  const [resetTargetLectureIds, setResetTargetLectureIds] = useState([])
  const [resetError, setResetError] = useState('')
  const [resetSuccess, setResetSuccess] = useState('')
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetConfirmChecked, setResetConfirmChecked] = useState(false)
  const [resetConfirmInput, setResetConfirmInput] = useState('')
  const [resettingProgress, setResettingProgress] = useState(false)
  const [resetRefreshTick, setResetRefreshTick] = useState(0)

  // Load settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      const { data, error } = await getUserSettings()
      if (!error && data?.exam_date) {
        setExamDateState(data.exam_date)
      }
      setExamLoading(false)
    }
    fetchSettings()

    // Load display name from user metadata
    if (user?.user_metadata?.display_name) {
      setDisplayName(user.user_metadata.display_name)
    }
  }, [user])

  useEffect(() => {
    const loadResetFilters = async () => {
      if (!user?.id) return
      setResetFilterLoading(true)
      setResetError('')

      try {
        const [modulesRes, lecturesRes] = await Promise.all([
          supabase
            .from('modules')
            .select('id, name')
            .eq('user_id', user.id)
            .order('display_order', { ascending: true }),
          supabase
            .from('lectures')
            .select('id, title, module_id')
            .eq('user_id', user.id)
            .order('display_order', { ascending: true }),
        ])

        if (modulesRes.error) throw modulesRes.error
        if (lecturesRes.error) throw lecturesRes.error

        setModules(modulesRes.data || [])
        setLectures(lecturesRes.data || [])
      } catch (error) {
        setResetError(error?.message || 'Failed to load modules and lectures for reset options')
      } finally {
        setResetFilterLoading(false)
      }
    }

    loadResetFilters()
  }, [user?.id])

  const canPreviewReset =
    resetScope === 'all' ||
    (resetScope === 'modules' && selectedModuleIds.length > 0) ||
    (resetScope === 'lectures' && selectedLectureIds.length > 0)

  useEffect(() => {
    const updatePreview = async () => {
      setResetSuccess('')
      if (!canPreviewReset) {
        setResetPreviewCount(0)
        setResetTargetLectureIds([])
        return
      }

      setResetPreviewLoading(true)
      setResetError('')
      const { count, lectureIds, error } = await previewResetCount({
        scope: resetScope,
        moduleIds: selectedModuleIds,
        lectureIds: selectedLectureIds,
      })

      if (error) {
        setResetError(error.message)
        setResetPreviewCount(0)
        setResetTargetLectureIds([])
      } else {
        setResetPreviewCount(count || 0)
        setResetTargetLectureIds(Array.isArray(lectureIds) ? lectureIds : [])
      }

      setResetPreviewLoading(false)
    }

    updatePreview()
  }, [canPreviewReset, resetScope, selectedModuleIds, selectedLectureIds, resetRefreshTick])

  // Exam date handlers
  const handleSaveExamDate = async () => {
    setExamSaving(true)
    await setExamDate(examDate || null)
    setExamSaving(false)
  }

  const handleClearExamDate = async () => {
    setExamDateState('')
    setExamSaving(true)
    await setExamDate(null)
    setExamSaving(false)
  }

  // Display name handler
  const handleSaveDisplayName = async () => {
    if (!displayName.trim()) return

    setNameSaving(true)
    const { error } = await onUpdateDisplayName(displayName.trim())
    setNameSaving(false)

    if (!error) {
      setNameSuccess(true)
      setTimeout(() => setNameSuccess(false), 2000)
    }
  }

  // Password handler
  const handleChangePassword = async (e) => {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess(false)

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters')
      return
    }

    setPasswordSaving(true)
    const { error } = await onUpdatePassword(newPassword)
    setPasswordSaving(false)

    if (error) {
      setPasswordError(error.message)
    } else {
      setPasswordSuccess(true)
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordSuccess(false), 3000)
    }
  }

  const toggleModuleSelection = (moduleId) => {
    setSelectedModuleIds((prev) =>
      prev.includes(moduleId) ? prev.filter((id) => id !== moduleId) : [...prev, moduleId]
    )
  }

  const toggleLectureSelection = (lectureId) => {
    setSelectedLectureIds((prev) =>
      prev.includes(lectureId) ? prev.filter((id) => id !== lectureId) : [...prev, lectureId]
    )
  }

  const clearResetConfirmState = () => {
    setResetConfirmChecked(false)
    setResetConfirmInput('')
    setShowResetConfirm(false)
  }

  const clearPersistedReviewSessions = (lectureIds = []) => {
    if (!user?.id) return
    clearPersistedSession({ userId: user.id, mode: 'review-global', scope: 'global' })
    clearPersistedSession({ userId: user.id, mode: 'custom-study', scope: 'custom-study' })
    for (const lectureId of lectureIds) {
      clearPersistedSession({
        userId: user.id,
        mode: 'learn-lecture',
        scope: `lecture:${lectureId}`,
      })
    }
  }

  const clearLectureDailyCapFlags = (lectureIds = []) => {
    if (!user?.id) return
    for (const lectureId of lectureIds) {
      try {
        localStorage.removeItem(`lecture-review-daily-limit:v1:${user.id}:${lectureId}`)
      } catch {
        // best effort only
      }
    }
  }

  const handleResetProgress = async () => {
    setResettingProgress(true)
    setResetError('')
    setResetSuccess('')

    const { resetCount, lectureIds, error } = await resetFlashcardProgress({
      scope: resetScope,
      moduleIds: selectedModuleIds,
      lectureIds: selectedLectureIds,
    })

    setResettingProgress(false)

    if (error) {
      setResetError(error.message || 'Failed to reset flashcard progress')
      return
    }

    const affectedLectureIds = Array.isArray(lectureIds) ? lectureIds : resetTargetLectureIds
    clearPersistedReviewSessions(affectedLectureIds)
    clearLectureDailyCapFlags(affectedLectureIds)
    clearResetConfirmState()
    setResetSuccess(
      resetCount > 0
        ? `Reset progress for ${resetCount} flashcard${resetCount === 1 ? '' : 's'}.`
        : 'No flashcards matched this reset scope.'
    )
    setResetRefreshTick((prev) => prev + 1)
  }

  const lecturesByModule = lectures.reduce((acc, lecture) => {
    const moduleId = lecture.module_id || 'unassigned'
    if (!acc[moduleId]) acc[moduleId] = []
    acc[moduleId].push(lecture)
    return acc
  }, {})

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-secondary" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-primary">Settings</h1>
          <p className="text-secondary mt-1">Configure your account and preferences</p>
        </div>
      </div>

      {/* Settings content */}
      <div className="max-w-2xl flex flex-col gap-4">

        {/* Display Name Setting */}
        <div className="order-1 bg-surface rounded-xl border border-divider p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <User className="w-5 h-5 text-accent" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-primary mb-1">Display Name</h3>
              <p className="text-sm text-secondary mb-4">
                Set your name to personalise your dashboard greeting.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your name"
                  className="flex-1 px-4 py-2 bg-background border border-divider rounded-lg text-primary focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors"
                />
                <button
                  onClick={handleSaveDisplayName}
                  disabled={nameSaving || !displayName.trim()}
                  className="px-4 py-2 bg-accent hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {nameSuccess ? (
                    <>
                      <Check className="w-4 h-4" />
                      Saved
                    </>
                  ) : nameSaving ? (
                    'Saving...'
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Exam Date Setting */}
        <div className="order-2 bg-surface rounded-xl border border-divider p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Calendar className="w-5 h-5 text-accent" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-primary mb-1">Exam Date</h3>
              <p className="text-sm text-secondary mb-4">
                Set your exam date to optimise flashcard scheduling. The system will ensure
                you review cards multiple times before your exam.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDateState(e.target.value)}
                  className="px-4 py-2 bg-background border border-divider rounded-lg text-primary focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors"
                  disabled={examLoading}
                />
                <button
                  onClick={handleSaveExamDate}
                  disabled={examSaving || examLoading}
                  className="px-4 py-2 bg-accent hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {examSaving ? 'Saving...' : 'Save'}
                </button>
                {examDate && (
                  <button
                    onClick={handleClearExamDate}
                    disabled={examSaving}
                    className="px-4 py-2 text-secondary hover:text-primary transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Change Password Setting */}
        <div className="order-4 bg-surface rounded-xl border border-divider p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Key className="w-5 h-5 text-accent" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-primary mb-1">Change Password</h3>
              <p className="text-sm text-secondary mb-4">
                Update your account password.
              </p>

              <form onSubmit={handleChangePassword} className="space-y-3">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password"
                  className="w-full px-4 py-2 bg-background border border-divider rounded-lg text-primary focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors"
                  required
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full px-4 py-2 bg-background border border-divider rounded-lg text-primary focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors"
                  required
                />

                {passwordError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                    {passwordError}
                  </div>
                )}

                {passwordSuccess && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-600 text-sm flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Password updated successfully
                  </div>
                )}

                <button
                  type="submit"
                  disabled={passwordSaving || !newPassword || !confirmPassword}
                  className="px-4 py-2 bg-accent hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {passwordSaving ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Account Info */}
        <div className="order-5 bg-surface rounded-xl border border-divider p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-accent" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-primary mb-1">Account</h3>
              <p className="text-sm text-secondary">
                Signed in as <span className="text-primary font-medium">{user?.email}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Reset Flashcard Progress */}
        <div className="order-3 bg-surface rounded-xl border border-divider p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <RotateCcw className="w-5 h-5 text-accent" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-primary mb-1">Reset Flashcard Progress</h3>
              <p className="text-sm text-secondary mb-4">
                Reset SRS progress without deleting cards. This sets selected cards back to new.
              </p>

              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-primary">
                  <input
                    type="radio"
                    name="reset-scope"
                    checked={resetScope === 'all'}
                    onChange={() => {
                      setResetScope('all')
                      setSelectedModuleIds([])
                      setSelectedLectureIds([])
                    }}
                  />
                  All flashcards
                </label>
                <label className="flex items-center gap-2 text-sm text-primary">
                  <input
                    type="radio"
                    name="reset-scope"
                    checked={resetScope === 'modules'}
                    onChange={() => {
                      setResetScope('modules')
                      setSelectedLectureIds([])
                    }}
                  />
                  Flashcards in selected module(s)
                </label>
                <label className="flex items-center gap-2 text-sm text-primary">
                  <input
                    type="radio"
                    name="reset-scope"
                    checked={resetScope === 'lectures'}
                    onChange={() => {
                      setResetScope('lectures')
                      setSelectedModuleIds([])
                    }}
                  />
                  Flashcards in selected lecture(s)
                </label>
              </div>

              {resetScope === 'modules' && (
                <div className="mt-4 border border-divider rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                  {resetFilterLoading ? (
                    <p className="text-sm text-secondary">Loading modules...</p>
                  ) : modules.length === 0 ? (
                    <p className="text-sm text-secondary">No modules found.</p>
                  ) : (
                    modules.map((module) => (
                      <label key={module.id} className="flex items-center gap-2 text-sm text-primary">
                        <input
                          type="checkbox"
                          checked={selectedModuleIds.includes(module.id)}
                          onChange={() => toggleModuleSelection(module.id)}
                        />
                        {module.name}
                      </label>
                    ))
                  )}
                </div>
              )}

              {resetScope === 'lectures' && (
                <div className="mt-4 border border-divider rounded-lg p-3 max-h-52 overflow-y-auto space-y-3">
                  {resetFilterLoading ? (
                    <p className="text-sm text-secondary">Loading lectures...</p>
                  ) : lectures.length === 0 ? (
                    <p className="text-sm text-secondary">No lectures found.</p>
                  ) : (
                    modules.map((module) => {
                      const moduleLectures = lecturesByModule[module.id] || []
                      if (moduleLectures.length === 0) return null
                      return (
                        <div key={module.id}>
                          <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1">
                            {module.name}
                          </p>
                          <div className="space-y-1">
                            {moduleLectures.map((lecture) => (
                              <label key={lecture.id} className="flex items-center gap-2 text-sm text-primary">
                                <input
                                  type="checkbox"
                                  checked={selectedLectureIds.includes(lecture.id)}
                                  onChange={() => toggleLectureSelection(lecture.id)}
                                />
                                {lecture.title}
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              )}

              <div className="mt-4 flex items-center gap-2 text-sm">
                {resetPreviewLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 text-secondary animate-spin" />
                    <span className="text-secondary">Calculating impacted cards...</span>
                  </>
                ) : (
                  <span className="text-secondary">
                    Impacted cards: <span className="text-primary font-semibold">{resetPreviewCount}</span>
                  </span>
                )}
              </div>

              {resetError && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {resetError}
                </div>
              )}

              {resetSuccess && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                  {resetSuccess}
                </div>
              )}

              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={resettingProgress || !canPreviewReset || resetPreviewLoading || resetPreviewCount === 0}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {resettingProgress ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Reset Progress
              </button>
            </div>
          </div>
        </div>
      </div>

      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-divider shadow-xl max-w-md w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
              <div>
                <h3 className="text-lg font-semibold text-primary">Confirm Progress Reset</h3>
                <p className="text-sm text-secondary mt-1">
                  This will reset {resetPreviewCount} flashcard{resetPreviewCount === 1 ? '' : 's'} to new state.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm text-primary">
                <input
                  type="checkbox"
                  checked={resetConfirmChecked}
                  onChange={(e) => setResetConfirmChecked(e.target.checked)}
                  className="mt-0.5"
                />
                I understand this cannot be undone in bulk.
              </label>
              <div>
                <label className="block text-sm text-primary mb-1">
                  Type <span className="font-semibold">RESET</span> to continue
                </label>
                <input
                  type="text"
                  value={resetConfirmInput}
                  onChange={(e) => setResetConfirmInput(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-divider rounded-lg text-primary"
                  placeholder="RESET"
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={clearResetConfirmState}
                disabled={resettingProgress}
                className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-primary font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleResetProgress}
                disabled={resettingProgress || !resetConfirmChecked || resetConfirmInput.trim() !== 'RESET'}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg font-medium flex items-center justify-center gap-2"
              >
                {resettingProgress ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  'Confirm Reset'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
