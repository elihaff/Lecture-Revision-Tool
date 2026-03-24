import { useState, useEffect, useMemo } from 'react'
import { Play, BookOpen, Sparkles, BarChart3, Settings, Loader2, History } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { STATE } from '../lib/srsAlgorithmV2'

// Average time per card in seconds (for estimation)
const SECONDS_PER_CARD = 30

// Motivational quotes that rotate randomly on each page load
const MOTIVATIONAL_QUOTES = [
  { text: "Cards don't review themselves.", quoted: false },
  { text: "Just start. The rest follows.", quoted: false },
  { text: "Momentum > motivation.", quoted: false },
  { text: "Quiet progress, big results.", quoted: false },
  { text: "Lock in.", quoted: false },
  { text: "One flashcard, just one.", quoted: false },
  { text: "Effort compounds. So does neglect.", quoted: false },
  { text: "No distractions, no excuses.", quoted: false },
  { text: "Do it. Do it. Do it.", quoted: false },
  { text: "You know what to do.", quoted: false },
  { text: "work, work, work, work, work, work", author: "Rihanna", quoted: true },
]

export function WheelDashboard({ user, onNavigate }) {
  const [dueCount, setDueCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hoveredSegment, setHoveredSegment] = useState(null)

  // Pick a random quote once per component mount
  const randomQuote = useMemo(() => {
    const index = Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)
    return MOTIVATIONAL_QUOTES[index]
  }, [])

  // Format quote for display
  const formatQuote = (quote) => {
    if (quote.quoted) {
      return (
        <>
          "{quote.text}"
          {quote.author && <><br />- {quote.author}</>}
        </>
      )
    }
    return quote.text
  }

  // Extract user's first name from email or metadata
  const getUserFirstName = () => {
    if (user?.user_metadata?.display_name) {
      return user.user_metadata.display_name.split(' ')[0]
    }
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name.split(' ')[0]
    }
    if (user?.user_metadata?.name) {
      return user.user_metadata.name.split(' ')[0]
    }
    if (user?.email) {
      const emailPrefix = user.email.split('@')[0]
      return emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1)
    }
    return 'there'
  }

  const firstName = getUserFirstName()

  // Fetch due cards count on mount
  useEffect(() => {
    const fetchDueCounts = async () => {
      setLoading(true)

      const endOfToday = new Date()
      endOfToday.setHours(23, 59, 59, 999)

      // Count cards due today for review sessions:
      // RELEARNING + REVIEW only (excludes NEW and LEARNING).
      const { count: dueCards } = await supabase
        .from('flashcards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .lte('due_date', endOfToday.toISOString())
        .eq('suspended', false)
        .or('buried.eq.false,buried.is.null')
        .in('state', [STATE.RELEARNING, STATE.REVIEW])

      setDueCount(dueCards || 0)
      setLoading(false)
    }

    fetchDueCounts()
  }, [user.id])

  // Calculate estimated time
  const totalCards = dueCount
  const estimatedMinutes = Math.ceil((totalCards * SECONDS_PER_CARD) / 60)
  const hasCardsDue = dueCount > 0

  // Wheel segments configuration (Start Review at top, then clockwise)
  const segments = [
    { id: 'start-review', label: 'Start Review', icon: Play, action: () => onNavigate('review') },
    { id: 'modules', label: 'View Modules', icon: BookOpen, action: () => onNavigate('modules') },
    { id: 'stats', label: 'Stats', icon: BarChart3, action: () => onNavigate('stats') },
    { id: 'settings', label: 'Settings', icon: Settings, action: () => onNavigate('settings') },
    { id: 'session-log', label: 'Session Log', icon: History, action: () => onNavigate('session-log') },
    { id: 'custom-study', label: 'Custom Study', icon: Sparkles, action: () => onNavigate('custom-study') },
  ]

  const numSegments = segments.length
  const anglePerSegment = 360 / numSegments

  // SVG parameters
  const size = 660
  const center = size / 2
  const outerRadius = 315
  const innerRadius = 185
  const strokeWidth = 1

  // Offset to center first segment at top
  const angleOffset = -anglePerSegment / 2

  // Create arc path for a segment
  const createArcPath = (startAngle, endAngle, outer, inner) => {
    const startRad = (startAngle + angleOffset - 90) * (Math.PI / 180)
    const endRad = (endAngle + angleOffset - 90) * (Math.PI / 180)

    const x1 = center + outer * Math.cos(startRad)
    const y1 = center + outer * Math.sin(startRad)
    const x2 = center + outer * Math.cos(endRad)
    const y2 = center + outer * Math.sin(endRad)
    const x3 = center + inner * Math.cos(endRad)
    const y3 = center + inner * Math.sin(endRad)
    const x4 = center + inner * Math.cos(startRad)
    const y4 = center + inner * Math.sin(startRad)

    const largeArc = endAngle - startAngle > 180 ? 1 : 0

    return `M ${x1} ${y1} A ${outer} ${outer} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${largeArc} 0 ${x4} ${y4} Z`
  }

  // Get position for icon/label in segment
  const getSegmentCenter = (index) => {
    const midAngle = (index * anglePerSegment + anglePerSegment / 2 + angleOffset - 90) * (Math.PI / 180)
    const radius = (outerRadius + innerRadius) / 2
    return {
      x: center + radius * Math.cos(midAngle),
      y: center + radius * Math.sin(midAngle),
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 md:p-8">
      <div className="relative" style={{ width: size, height: size }}>
        {/* SVG Wheel */}
        <svg width={size} height={size} className="absolute inset-0">
          {/* Segments */}
          {segments.map((segment, index) => {
            const startAngle = index * anglePerSegment
            const endAngle = (index + 1) * anglePerSegment
            const path = createArcPath(startAngle, endAngle, outerRadius, innerRadius)
            const isHovered = hoveredSegment === segment.id

            return (
              <path
                key={segment.id}
                d={path}
                fill={isHovered ? '#F0F0F2' : '#FFFFFF'}
                stroke="#E5E5EA"
                strokeWidth={strokeWidth}
                className="cursor-pointer transition-colors duration-150"
                onMouseEnter={() => setHoveredSegment(segment.id)}
                onMouseLeave={() => setHoveredSegment(null)}
                onClick={segment.action}
              />
            )
          })}

          {/* Divider lines */}
          {segments.map((_, index) => {
            const angle = (index * anglePerSegment + angleOffset - 90) * (Math.PI / 180)
            const x1 = center + innerRadius * Math.cos(angle)
            const y1 = center + innerRadius * Math.sin(angle)
            const x2 = center + outerRadius * Math.cos(angle)
            const y2 = center + outerRadius * Math.sin(angle)

            return (
              <line
                key={`line-${index}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#E5E5EA"
                strokeWidth={strokeWidth}
              />
            )
          })}

          {/* Inner circle border */}
          <circle
            cx={center}
            cy={center}
            r={innerRadius}
            fill="none"
            stroke="#E5E5EA"
            strokeWidth={strokeWidth}
          />

          {/* Outer circle border */}
          <circle
            cx={center}
            cy={center}
            r={outerRadius}
            fill="none"
            stroke="#E5E5EA"
            strokeWidth={strokeWidth}
          />
        </svg>

        {/* Segment Labels (positioned over SVG) */}
        {segments.map((segment, index) => {
          const pos = getSegmentCenter(index)
          const Icon = segment.icon
          const isHovered = hoveredSegment === segment.id

          return (
            <div
              key={`label-${segment.id}`}
              className="absolute flex w-[120px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center text-center pointer-events-none"
              style={{
                left: pos.x,
                top: pos.y,
              }}
            >
              <Icon
                className={`w-7 h-7 mb-2 transition-opacity text-primary ${
                  isHovered ? 'opacity-100' : 'opacity-70'
                }`}
              />
              <span
                className={`text-sm font-medium text-center transition-opacity text-primary ${
                  isHovered ? 'opacity-100' : 'opacity-70'
                }`}
              >
                {segment.label}
              </span>
            </div>
          )
        })}

        {/* Centre Content (hollow centre) */}
        <div
          className="absolute flex flex-col items-center justify-center cursor-pointer"
          style={{
            left: center,
            top: center,
            transform: 'translate(-50%, -50%)',
            width: innerRadius * 2 - 20,
            height: innerRadius * 2 - 20,
          }}
          onClick={() => hasCardsDue ? onNavigate('review') : onNavigate('modules')}
        >
          {loading ? (
            <Loader2 className="w-8 h-8 text-secondary animate-spin" />
          ) : (
            <>
              {/* Greeting */}
              <h1 className="text-3xl font-semibold text-primary mb-2">
                Hi {firstName}
              </h1>

              {/* Cards due or Get started */}
              {hasCardsDue ? (
                <div className="text-center">
                  <p className="text-xl text-primary">
                    {dueCount} cards due
                  </p>
                  <p className="text-sm text-secondary">
                    ~{estimatedMinutes} min
                  </p>
                </div>
              ) : (
                <p className="text-xl text-primary">
                  Get started
                </p>
              )}

              {/* Motivational Quote */}
              <p className="text-xs text-secondary/50 mt-4 italic text-center px-3 leading-tight">
                {formatQuote(randomQuote)}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
