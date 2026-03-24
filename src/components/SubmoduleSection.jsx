import { useState } from 'react'
import { ChevronDown, ChevronRight, GripVertical, Trash2, Plus, Pencil, BookOpen } from 'lucide-react'

export function SubmoduleSection({
  submodule,
  lectures,
  onDeleteSubmodule,
  onEditSubmodule,
  onDeleteLecture,
  onEditLecture,
  onAddLecture,
  onDragStart,
  onDrop,
  onLectureDragStart,
  onLectureDrop,
  onLectureDropToSubmodule,
  onLectureDropAtIndex,
  draggedLecture,
  draggedSubmodule,
  onLectureClick,
}) {
  const [isCollapsed, setIsCollapsed] = useState(submodule.is_collapsed || false)
  const [isDragOverSubmodule, setIsDragOverSubmodule] = useState(false)
  const [lectureDropIndex, setLectureDropIndex] = useState(null)

  const handleSubmoduleDragOver = (e) => {
    e.preventDefault()
    if (draggedLecture && draggedLecture.submodule_id !== submodule.id) {
      setIsDragOverSubmodule(true)
    }
  }

  const handleSubmoduleDragLeave = (e) => {
    e.preventDefault()
    setIsDragOverSubmodule(false)
  }

  const handleSubmoduleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOverSubmodule(false)
    setLectureDropIndex(null)

    if (draggedLecture && onLectureDropToSubmodule) {
      onLectureDropToSubmodule(e, submodule.id)
    } else if (draggedSubmodule && !draggedLecture) {
      onDrop(e, submodule)
    }
  }

  const handleLectureDropZoneDragEnter = (e, index) => {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedLecture) return

    const draggedIdx = lectures.findIndex((l) => l.id === draggedLecture.id)
    const isFromSameSubmodule = draggedLecture.submodule_id === submodule.id

    if (!isFromSameSubmodule || (draggedIdx !== index && draggedIdx !== index - 1)) {
      setLectureDropIndex(index)
    }
  }

  const handleLectureDropZoneDragOver = (e, index) => {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedLecture) return

    const draggedIdx = lectures.findIndex((l) => l.id === draggedLecture.id)
    const isFromSameSubmodule = draggedLecture.submodule_id === submodule.id

    if (!isFromSameSubmodule || (draggedIdx !== index && draggedIdx !== index - 1)) {
      setLectureDropIndex(index)
    }
  }

  const handleLectureDropZoneDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleLectureDropAtPosition = (e, index) => {
    e.preventDefault()
    e.stopPropagation()
    setLectureDropIndex(null)
    if (onLectureDropAtIndex) {
      onLectureDropAtIndex(e, submodule.id, index)
    }
  }

  return (
    <div
      className="mb-2"
      draggable={!draggedLecture}
      onDragStart={(e) => {
        if (!draggedLecture) {
          onDragStart(e, submodule)
        }
      }}
      onDragOver={handleSubmoduleDragOver}
      onDragLeave={handleSubmoduleDragLeave}
      onDrop={handleSubmoduleDrop}
    >
      {/* Submodule Header */}
      <div
        className={`group flex items-start bg-gray-50 rounded-lg border transition-colours min-h-[52px] ${
          isDragOverSubmodule && draggedLecture
            ? 'border-accent bg-blue-50'
            : 'border-divider hover:border-gray-300'
        }`}
      >
        {/* Column 1: Drag handle - 40px fixed */}
        <div className="w-10 flex-shrink-0 flex justify-center pt-4">
          <div className="cursor-grab active:cursor-grabbing text-secondary hover:text-primary">
            <GripVertical className="w-4 h-4" />
          </div>
        </div>

        {/* Column 2: Collapse button - 32px fixed */}
        <div className="w-8 flex-shrink-0 pt-4">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-secondary hover:text-primary"
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Column 3: Submodule name - fills space, max-width restricted, wraps to new line */}
        <div className="flex-1 min-w-0 py-3 pr-4 max-w-[400px]">
          <span className="font-medium text-primary leading-snug block">
            {submodule.name}
          </span>
        </div>

        {/* Spacer - pushes lecture count and actions to the right */}
        <div className="flex-1"></div>

        {/* Column 4: Lecture count - 130px fixed from right, left-aligned (matches ModuleCard) */}
        <div className="w-[130px] flex-shrink-0 flex items-center gap-2 text-secondary text-sm pt-3.5">
          <BookOpen className="w-4 h-4 flex-shrink-0" />
          <span className="whitespace-nowrap">{lectures.length} {lectures.length === 1 ? 'lecture' : 'lectures'}</span>
        </div>

        {/* Column 5: Action buttons - 100px fixed, right-aligned */}
        <div className="w-[100px] flex-shrink-0 flex items-center justify-end gap-0.5 pr-2 pt-3 opacity-0 group-hover:opacity-100 transition-all">
          <button
            onClick={() => onAddLecture(submodule.id)}
            className="p-1.5 text-secondary hover:text-accent hover:bg-blue-50 rounded transition-all"
            title="Add lecture to submodule"
          >
            <Plus className="w-4 h-4" />
          </button>

          <button
            onClick={() => onEditSubmodule(submodule)}
            className="p-1.5 text-secondary hover:text-accent hover:bg-blue-50 rounded transition-all"
            title="Edit submodule"
          >
            <Pencil className="w-4 h-4" />
          </button>

          <button
            onClick={() => onDeleteSubmodule(submodule.id)}
            className="p-1.5 text-secondary hover:text-error hover:bg-red-50 rounded transition-all"
            title="Delete submodule"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Lectures */}
      {!isCollapsed && (
        <div
          className={`ml-10 mt-2 min-h-[40px] rounded-lg transition-colours ${
            isDragOverSubmodule && draggedLecture && lectures.length === 0
              ? 'bg-blue-50 border-2 border-dashed border-accent/50'
              : ''
          }`}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onDrop={(e) => {
            e.stopPropagation()
            if (draggedLecture && onLectureDropToSubmodule) {
              onLectureDropToSubmodule(e, submodule.id)
            }
            setIsDragOverSubmodule(false)
            setLectureDropIndex(null)
          }}
        >
          {lectures.length === 0 ? (
            <div className={`py-3 px-4 text-sm text-secondary italic ${
              isDragOverSubmodule && draggedLecture ? 'text-accent' : ''
            }`}>
              {isDragOverSubmodule && draggedLecture ? 'Drop lecture here' : 'No lectures yet'}
            </div>
          ) : (
            <div className="flex flex-col">
              {/* Drop zone at top */}
              <div
                onDragEnter={(e) => handleLectureDropZoneDragEnter(e, 0)}
                onDragOver={(e) => handleLectureDropZoneDragOver(e, 0)}
                onDragLeave={handleLectureDropZoneDragLeave}
                onDrop={(e) => handleLectureDropAtPosition(e, 0)}
                className={`h-2 transition-all duration-150 rounded-full mx-1 ${
                  draggedLecture && lectureDropIndex === 0 ? 'bg-accent h-1 my-1' : ''
                }`}
              />

              {lectures.map((lecture, index) => (
                <div key={lecture.id}>
                  <div
                    draggable
                    onClick={() => onLectureClick && onLectureClick(lecture)}
                    onDragStart={(e) => {
                      e.stopPropagation()
                      onLectureDragStart(e, lecture)
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onDrop={(e) => {
                      e.stopPropagation()
                      setLectureDropIndex(null)
                      onLectureDrop(e, lecture, submodule.id)
                    }}
                    className={`group flex items-start bg-surface rounded-lg border transition-all cursor-pointer hover:shadow-sm min-h-[44px] ${
                      draggedLecture?.id === lecture.id
                        ? 'opacity-50 border-accent'
                        : 'border-divider hover:border-gray-300'
                    }`}
                  >
                    {/* Column 1: Drag handle - 40px fixed */}
                    <div className="w-10 flex-shrink-0 flex items-center justify-center py-3">
                      <div className="text-secondary hover:text-primary">
                        <GripVertical className="w-4 h-4" />
                      </div>
                    </div>

                    {/* Column 2: Lecture title - fixed max-width 400px, left-aligned, wraps to new line */}
                    <div className="w-[400px] flex-shrink py-3 pr-4">
                      <span className="text-primary leading-snug block">
                        {lecture.title}
                      </span>
                    </div>

                    {/* Column 3: Action buttons - remaining space, right-aligned */}
                    <div className="flex-1 flex items-center justify-end gap-0.5 pr-2 pt-2.5 opacity-0 group-hover:opacity-100 transition-all">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onEditLecture(lecture)
                        }}
                        className="p-1.5 text-secondary hover:text-accent hover:bg-blue-50 rounded transition-all"
                        title="Edit lecture"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteLecture(lecture.id)
                        }}
                        className="p-1.5 text-secondary hover:text-error hover:bg-red-50 rounded transition-all"
                        title="Delete lecture"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {/* Drop zone after each lecture */}
                  <div
                    onDragEnter={(e) => handleLectureDropZoneDragEnter(e, index + 1)}
                    onDragOver={(e) => handleLectureDropZoneDragOver(e, index + 1)}
                    onDragLeave={handleLectureDropZoneDragLeave}
                    onDrop={(e) => handleLectureDropAtPosition(e, index + 1)}
                    className={`h-2 transition-all duration-150 rounded-full mx-1 ${
                      draggedLecture && lectureDropIndex === index + 1 ? 'bg-accent h-1 my-1' : ''
                    }`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
