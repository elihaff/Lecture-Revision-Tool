import { useState, useEffect, useRef } from 'react'
import { Plus, BookOpen, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ModuleCard } from './ModuleCard'
import { CreateModuleModal } from './CreateModuleModal'
import { EditModuleModal } from './EditModuleModal'
import { ModuleView } from './ModuleView'

export function Dashboard({ user }) {
  const [modules, setModules] = useState([])
  const [lectureCounts, setLectureCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingModule, setEditingModule] = useState(null)
  const [selectedModule, setSelectedModule] = useState(null)
  const [draggedModule, setDraggedModule] = useState(null)
  const [dropIndex, setDropIndex] = useState(null)
  const dragCounter = useRef(0)

  // Fetch modules on mount
  useEffect(() => {
    fetchModules()
  }, [])

  const fetchModules = async () => {
    setLoading(true)

    // Fetch modules with ordering
    const { data: modulesData, error: modulesError } = await supabase
      .from('modules')
      .select('*')
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: false })

    if (modulesError) {
      console.error('Error fetching modules:', modulesError)
      setLoading(false)
      return
    }

    setModules(modulesData || [])

    // Fetch lecture counts for each module
    if (modulesData && modulesData.length > 0) {
      const { data: lecturesData, error: lecturesError } = await supabase
        .from('lectures')
        .select('module_id')

      if (!lecturesError && lecturesData) {
        const counts = {}
        lecturesData.forEach((lecture) => {
          counts[lecture.module_id] = (counts[lecture.module_id] || 0) + 1
        })
        setLectureCounts(counts)
      }
    }

    setLoading(false)
  }

  const handleCreateModule = async (moduleData) => {
    const maxOrder = Math.max(0, ...modules.map((m) => m.display_order || 0))

    const { data, error } = await supabase
      .from('modules')
      .insert([
        {
          user_id: user.id,
          name: moduleData.name,
          abbreviation: moduleData.abbreviation,
          color: moduleData.color,
          display_order: maxOrder + 1,
        },
      ])
      .select()
      .single()

    if (error) {
      console.error('Error creating module:', error)
      return { error }
    }

    setModules((prev) => [...prev, data])
    setShowCreateModal(false)
    return { data }
  }

  const handleDeleteModule = async (moduleId) => {
    if (!confirm('Are you sure you want to delete this module? This will also delete all lectures in it.')) {
      return
    }

    const { error } = await supabase
      .from('modules')
      .delete()
      .eq('id', moduleId)

    if (error) {
      console.error('Error deleting module:', error)
      return
    }

    setModules((prev) => prev.filter((m) => m.id !== moduleId))
  }

  const handleEditModule = async (moduleData) => {
    const { error } = await supabase
      .from('modules')
      .update({
        name: moduleData.name,
        abbreviation: moduleData.abbreviation,
        color: moduleData.color,
      })
      .eq('id', editingModule.id)

    if (error) {
      console.error('Error updating module:', error)
      return { error }
    }

    setModules((prev) =>
      prev.map((m) =>
        m.id === editingModule.id
          ? { ...m, name: moduleData.name, abbreviation: moduleData.abbreviation, color: moduleData.color }
          : m
      )
    )
    setEditingModule(null)
    return {}
  }

  // Drag handlers
  const handleDragStart = (e, module) => {
    setDraggedModule(module)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', module.id)
  }

  const handleDragEnd = () => {
    setDraggedModule(null)
    setDropIndex(null)
    dragCounter.current = 0
  }

  const handleDropZoneDragEnter = (e, index) => {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedModule) return

    const draggedIdx = modules.findIndex((m) => m.id === draggedModule.id)
    // Only show indicator if it's a valid drop position
    if (index !== draggedIdx && index !== draggedIdx + 1) {
      setDropIndex(index)
    }
  }

  const handleDropZoneDragOver = (e, index) => {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedModule) return

    const draggedIdx = modules.findIndex((m) => m.id === draggedModule.id)
    if (index !== draggedIdx && index !== draggedIdx + 1) {
      setDropIndex(index)
    }
  }

  const handleDropZoneDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e, targetIndex) => {
    e.preventDefault()
    e.stopPropagation()

    if (!draggedModule) {
      setDropIndex(null)
      return
    }

    const oldIndex = modules.findIndex((m) => m.id === draggedModule.id)

    // Calculate actual new position
    let newIndex = targetIndex
    if (oldIndex < targetIndex) {
      newIndex = targetIndex - 1
    }

    // If same position, do nothing
    if (oldIndex === newIndex) {
      setDraggedModule(null)
      setDropIndex(null)
      return
    }

    const newModules = [...modules]
    newModules.splice(oldIndex, 1)
    newModules.splice(newIndex, 0, draggedModule)

    // Update display_order
    const updatedModules = newModules.map((m, i) => ({ ...m, display_order: i }))
    setModules(updatedModules)

    // Update in database
    for (const m of updatedModules) {
      await supabase
        .from('modules')
        .update({ display_order: m.display_order })
        .eq('id', m.id)
    }

    setDraggedModule(null)
    setDropIndex(null)
  }

  // If a module is selected, show the module view
  if (selectedModule) {
    return (
      <ModuleView
        module={selectedModule}
        user={user}
        onBack={() => {
          setSelectedModule(null)
          fetchModules() // Refresh counts when coming back
        }}
      />
    )
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-primary">Your Modules</h1>
          <p className="text-secondary mt-1">
            Organise your lectures by module
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-blue-600 rounded-xl font-medium text-white transition-colors"
        >
          <Plus className="w-5 h-5" />
          New Module
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      ) : modules.length === 0 ? (
        <div className="text-center py-20">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-2xl mb-4">
            <BookOpen className="w-8 h-8 text-secondary" />
          </div>
          <h2 className="text-xl font-semibold text-primary mb-2">
            No modules yet
          </h2>
          <p className="text-secondary mb-6 max-w-md mx-auto">
            Create your first module to start organising your lecture materials.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-blue-600 rounded-xl font-medium text-white transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Module
          </button>
        </div>
      ) : (
        <div className="flex flex-col">
          {/* Drop zone at top */}
          <div
            onDragEnter={(e) => handleDropZoneDragEnter(e, 0)}
            onDragOver={(e) => handleDropZoneDragOver(e, 0)}
            onDragLeave={handleDropZoneDragLeave}
            onDrop={(e) => handleDrop(e, 0)}
            className={`h-3 transition-all duration-150 rounded-full mx-1 ${
              dropIndex === 0 ? 'bg-accent h-1 my-2' : ''
            }`}
          />

          {modules.map((module, index) => (
            <div key={module.id}>
              <ModuleCard
                module={module}
                lectureCount={lectureCounts[module.id] || 0}
                onClick={() => setSelectedModule(module)}
                onDelete={handleDeleteModule}
                onEdit={setEditingModule}
                draggable={true}
                onDragStart={(e) => handleDragStart(e, module)}
                onDragEnd={handleDragEnd}
                isDragging={draggedModule?.id === module.id}
              />
              {/* Drop zone after each module */}
              <div
                onDragEnter={(e) => handleDropZoneDragEnter(e, index + 1)}
                onDragOver={(e) => handleDropZoneDragOver(e, index + 1)}
                onDragLeave={handleDropZoneDragLeave}
                onDrop={(e) => handleDrop(e, index + 1)}
                className={`h-3 transition-all duration-150 rounded-full mx-1 ${
                  dropIndex === index + 1 ? 'bg-accent h-1 my-2' : ''
                }`}
              />
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateModuleModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateModule}
        />
      )}

      {/* Edit Modal */}
      {editingModule && (
        <EditModuleModal
          module={editingModule}
          onClose={() => setEditingModule(null)}
          onSave={handleEditModule}
        />
      )}
    </div>
  )
}
