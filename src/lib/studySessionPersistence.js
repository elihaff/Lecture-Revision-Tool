const STORAGE_PREFIX = 'eli:study-session:v1'

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

const buildKey = ({ userId, mode, scope }) => {
  if (!userId || !mode || !scope) return null
  return `${STORAGE_PREFIX}:${userId}:${mode}:${scope}`
}

export function loadPersistedSession({ userId, mode, scope }) {
  if (!isBrowser()) return null
  const key = buildKey({ userId, mode, scope })
  if (!key) return null

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    // Failed to load persisted session - return null to start fresh
    return null
  }
}

export function persistSession({ userId, mode, scope, payload }) {
  if (!isBrowser()) return false
  const key = buildKey({ userId, mode, scope })
  if (!key || !payload || typeof payload !== 'object') return false

  try {
    window.localStorage.setItem(key, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      ...payload,
    }))
    return true
  } catch {
    // Failed to persist session - non-critical
    return false
  }
}

export function clearPersistedSession({ userId, mode, scope }) {
  if (!isBrowser()) return
  const key = buildKey({ userId, mode, scope })
  if (!key) return

  try {
    window.localStorage.removeItem(key)
  } catch {
    // Failed to clear session - non-critical
  }
}

export function formatSavedTime(savedAt) {
  if (!savedAt) return 'recently'

  const timestamp = new Date(savedAt)
  if (Number.isNaN(timestamp.getTime())) return 'recently'

  const diffMs = Date.now() - timestamp.getTime()
  if (diffMs < 60_000) return 'just now'
  if (diffMs < 3_600_000) {
    const mins = Math.max(1, Math.round(diffMs / 60_000))
    return `${mins} min ago`
  }

  return timestamp.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
