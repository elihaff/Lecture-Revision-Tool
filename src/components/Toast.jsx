import { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, type }])

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
    }

    return id
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = {
    success: (message, duration) => addToast(message, 'success', duration),
    error: (message, duration) => addToast(message, 'error', duration ?? 6000),
    info: (message, duration) => addToast(message, 'info', duration),
    warn: (message, duration) => addToast(message, 'warn', duration ?? 5000),
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  )
}

function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }) {
  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />,
    error: <AlertCircle className="w-5 h-5 text-error flex-shrink-0" />,
    warn: <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />,
    info: <Info className="w-5 h-5 text-accent flex-shrink-0" />,
  }

  const backgrounds = {
    success: 'bg-green-50 border-success/30',
    error: 'bg-red-50 border-error/30',
    warn: 'bg-amber-50 border-amber-400/30',
    info: 'bg-blue-50 border-accent/30',
  }

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg animate-slide-in ${backgrounds[toast.type] || backgrounds.info}`}
      role="alert"
    >
      {icons[toast.type] || icons.info}
      <p className="text-sm text-primary flex-1 whitespace-pre-wrap">{toast.message}</p>
      <button
        onClick={onDismiss}
        className="p-0.5 text-secondary hover:text-primary transition-colors flex-shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
