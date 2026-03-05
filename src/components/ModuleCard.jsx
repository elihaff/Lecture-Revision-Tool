import { BookOpen, Trash2, GripVertical, Pencil } from 'lucide-react'

export function ModuleCard({
  module,
  onDelete,
  onEdit,
  onClick,
  lectureCount = 0,
  draggable = false,
  onDragStart,
  onDragEnd,
  isDragging = false,
}) {
  const bgColor = module.color || '#007AFF'

  return (
    <div
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group flex items-center bg-surface rounded-xl p-4 border transition-all cursor-pointer ${
        isDragging
          ? 'opacity-50 border-accent shadow-lg'
          : 'border-divider hover:border-gray-300 hover:shadow-sm'
      }`}
      style={{ borderLeftColor: bgColor, borderLeftWidth: '4px' }}
    >
      {/* Column 1: Drag handle - 40px fixed */}
      <div className="w-10 flex-shrink-0 flex items-center justify-center">
        {draggable && (
          <div
            className="p-1 text-secondary hover:text-primary cursor-grab active:cursor-grabbing"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-5 h-5" />
          </div>
        )}
      </div>

      {/* Column 2: Abbreviation badge - 80px fixed, centre-aligned */}
      <div className="w-20 flex-shrink-0 flex justify-center">
        <div
          className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
          style={{ backgroundColor: `${bgColor}15`, color: bgColor }}
        >
          {module.abbreviation}
        </div>
      </div>

      {/* Column 3: Module name - fills remaining space, left-aligned, truncates */}
      <div className="flex-1 min-w-0 px-4">
        <h3 className="text-lg font-semibold text-primary leading-snug truncate">
          {module.name}
        </h3>
      </div>

      {/* Column 4: Lectures count - 130px fixed, left-aligned */}
      <div className="w-[130px] flex-shrink-0 flex items-center gap-2 text-secondary text-sm">
        <BookOpen className="w-4 h-4 flex-shrink-0" />
        <span className="whitespace-nowrap">{lectureCount} {lectureCount === 1 ? 'lecture' : 'lectures'}</span>
      </div>

      {/* Column 5: Action buttons - 80px fixed, right-aligned */}
      <div className="w-20 flex-shrink-0 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit(module)
          }}
          className="p-2 text-secondary hover:text-accent hover:bg-blue-50 rounded-lg transition-colours"
          title="Edit module"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete(module.id)
          }}
          className="p-2 text-secondary hover:text-error hover:bg-red-50 rounded-lg transition-colours"
          title="Delete module"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
