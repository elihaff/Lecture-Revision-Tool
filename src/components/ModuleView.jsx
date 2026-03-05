import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, FileText, Trash2, Loader2, FolderPlus, GripVertical, Pencil } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CreateLectureModal } from './CreateLectureModal'
import { CreateSubmoduleModal } from './CreateSubmoduleModal'
import { EditSubmoduleModal } from './EditSubmoduleModal'
import { EditLectureModal } from './EditLectureModal'
import { SubmoduleSection } from './SubmoduleSection'
import { LectureView } from './LectureView'

export function ModuleView({ module, user, onBack }) {
  const [lectures, setLectures] = useState([])
  const [submodules, setSubmodules] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateLectureModal, setShowCreateLectureModal] = useState(false)
  const [showCreateSubmoduleModal, setShowCreateSubmoduleModal] = useState(false)
  const [createLectureForSubmodule, setCreateLectureForSubmodule] = useState(null)
  const [editingSubmodule, setEditingSubmodule] = useState(null)
  const [editingLecture, setEditingLecture] = useState(null)
  const [selectedLecture, setSelectedLecture] = useState(null)

  // Drag state
  const [draggedSubmodule, setDraggedSubmodule] = useState(null)
  const [draggedLecture, setDraggedLecture] = useState(null)
  const [submoduleDropIndex, setSubmoduleDropIndex] = useState(null)
  const [unassignedDropIndex, setUnassignedDropIndex] = useState(null)

  useEffect(() => {
    fetchData()
  }, [module.id])

  const fetchData = async () => {
    setLoading(true)

    const { data: submodulesData, error: submodulesError } = await supabase
      .from('submodules')
      .select('*')
      .eq('module_id', module.id)
      .order('display_order', { ascending: true })

    if (submodulesError) {
      console.error('Error fetching submodules:', submodulesError)
    } else {
      setSubmodules(submodulesData || [])
    }

    const { data: lecturesData, error: lecturesError } = await supabase
      .from('lectures')
      .select('*')
      .eq('module_id', module.id)
      .order('display_order', { ascending: true })

    if (lecturesError) {
      console.error('Error fetching lectures:', lecturesError)
    } else {
      setLectures(lecturesData || [])
    }

    setLoading(false)
  }

  const getLecturesForSubmodule = (submoduleId) => {
    return lectures.filter((l) => l.submodule_id === submoduleId)
  }

  const getUnassignedLectures = () => {
    return lectures.filter((l) => !l.submodule_id)
  }

  const handleCreateSubmodule = async (data) => {
    const maxOrder = Math.max(0, ...submodules.map((s) => s.display_order || 0))

    const { data: newSubmodule, error } = await supabase
      .from('submodules')
      .insert([{
        user_id: user.id,
        module_id: module.id,
        name: data.name,
        display_order: maxOrder + 1,
      }])
      .select()
      .single()

    if (error) {
      console.error('Error creating submodule:', error)
      return { error }
    }

    setSubmodules((prev) => [...prev, newSubmodule])
    setShowCreateSubmoduleModal(false)
    return { data: newSubmodule }
  }

  const handleCreateLecture = async (data) => {
    const relevantLectures = createLectureForSubmodule
      ? getLecturesForSubmodule(createLectureForSubmodule)
      : getUnassignedLectures()
    const maxOrder = Math.max(0, ...relevantLectures.map((l) => l.display_order || 0))

    const { data: newLecture, error } = await supabase
      .from('lectures')
      .insert([{
        user_id: user.id,
        module_id: module.id,
        submodule_id: createLectureForSubmodule,
        title: data.title,
        display_order: maxOrder + 1,
      }])
      .select()
      .single()

    if (error) {
      console.error('Error creating lecture:', error)
      return { error }
    }

    setLectures((prev) => [...prev, newLecture])
    setShowCreateLectureModal(false)
    setCreateLectureForSubmodule(null)
    return { data: newLecture }
  }

  const handleDeleteSubmodule = async (submoduleId) => {
    if (!confirm('Delete this submodule? Lectures will become unassigned.')) return

    const { error } = await supabase
      .from('submodules')
      .delete()
      .eq('id', submoduleId)

    if (error) {
      console.error('Error deleting submodule:', error)
      return
    }

    setSubmodules((prev) => prev.filter((s) => s.id !== submoduleId))
    setLectures((prev) =>
      prev.map((l) => l.submodule_id === submoduleId ? { ...l, submodule_id: null } : l)
    )
  }

  const handleDeleteLecture = async (lectureId) => {
    if (!confirm('Delete this lecture?')) return

    const { error } = await supabase
      .from('lectures')
      .delete()
      .eq('id', lectureId)

    if (error) {
      console.error('Error deleting lecture:', error)
      return
    }

    setLectures((prev) => prev.filter((l) => l.id !== lectureId))
  }

  const handleEditSubmodule = async (data) => {
    const { error } = await supabase
      .from('submodules')
      .update({ name: data.name })
      .eq('id', editingSubmodule.id)

    if (error) {
      console.error('Error updating submodule:', error)
      return { error }
    }

    setSubmodules((prev) =>
      prev.map((s) => s.id === editingSubmodule.id ? { ...s, name: data.name } : s)
    )
    setEditingSubmodule(null)
    return {}
  }

  const handleEditLecture = async (data) => {
    const { error } = await supabase
      .from('lectures')
      .update({ title: data.title })
      .eq('id', editingLecture.id)

    if (error) {
      console.error('Error updating lecture:', error)
      return { error }
    }

    setLectures((prev) =>
      prev.map((l) => l.id === editingLecture.id ? { ...l, title: data.title } : l)
    )
    setEditingLecture(null)
    return {}
  }

  // Submodule drag handlers
  const handleSubmoduleDragStart = (e, submodule) => {
    setDraggedSubmodule(submodule)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', submodule.id)
  }

  const handleSubmoduleDragEnd = () => {
    setDraggedSubmodule(null)
    setSubmoduleDropIndex(null)
  }

  const handleSubmoduleDropZoneDragEnter = (e, index) => {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedSubmodule) return

    const draggedIdx = submodules.findIndex((s) => s.id === draggedSubmodule.id)
    if (index !== draggedIdx && index !== draggedIdx + 1) {
      setSubmoduleDropIndex(index)
    }
  }

  const handleSubmoduleDropZoneDragOver = (e, index) => {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedSubmodule) return

    const draggedIdx = submodules.findIndex((s) => s.id === draggedSubmodule.id)
    if (index !== draggedIdx && index !== draggedIdx + 1) {
      setSubmoduleDropIndex(index)
    }
  }

  const handleSubmoduleDropAtIndex = async (e, targetIndex) => {
    e.preventDefault()
    e.stopPropagation()

    if (!draggedSubmodule) {
      setSubmoduleDropIndex(null)
      return
    }

    const oldIndex = submodules.findIndex((s) => s.id === draggedSubmodule.id)
    let newIndex = targetIndex
    if (oldIndex < targetIndex) {
      newIndex = targetIndex - 1
    }

    if (oldIndex === newIndex) {
      setDraggedSubmodule(null)
      setSubmoduleDropIndex(null)
      return
    }

    const newSubmodules = [...submodules]
    newSubmodules.splice(oldIndex, 1)
    newSubmodules.splice(newIndex, 0, draggedSubmodule)

    const updates = newSubmodules.map((s, i) => ({ id: s.id, display_order: i }))
    setSubmodules(newSubmodules.map((s, i) => ({ ...s, display_order: i })))

    for (const update of updates) {
      await supabase
        .from('submodules')
        .update({ display_order: update.display_order })
        .eq('id', update.id)
    }

    setDraggedSubmodule(null)
    setSubmoduleDropIndex(null)
  }

  const handleSubmoduleDrop = async (e, targetSubmodule) => {
    e.preventDefault()
    if (!draggedSubmodule || draggedSubmodule.id === targetSubmodule.id) {
      setDraggedSubmodule(null)
      return
    }

    const oldIndex = submodules.findIndex((s) => s.id === draggedSubmodule.id)
    const newIndex = submodules.findIndex((s) => s.id === targetSubmodule.id)

    const newSubmodules = [...submodules]
    newSubmodules.splice(oldIndex, 1)
    newSubmodules.splice(newIndex, 0, draggedSubmodule)

    const updates = newSubmodules.map((s, i) => ({ id: s.id, display_order: i }))
    setSubmodules(newSubmodules.map((s, i) => ({ ...s, display_order: i })))

    for (const update of updates) {
      await supabase
        .from('submodules')
        .update({ display_order: update.display_order })
        .eq('id', update.id)
    }

    setDraggedSubmodule(null)
  }

  // Lecture drag handlers
  const handleLectureDragStart = (e, lecture) => {
    e.stopPropagation()
    setDraggedLecture(lecture)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', lecture.id)
  }

  const handleLectureDragEnd = () => {
    setDraggedLecture(null)
    setUnassignedDropIndex(null)
  }

  const handleLectureDrop = async (e, targetLecture, targetSubmoduleId) => {
    e.preventDefault()
    if (!draggedLecture || draggedLecture.id === targetLecture?.id) {
      setDraggedLecture(null)
      return
    }

    const targetLectures = targetSubmoduleId
      ? getLecturesForSubmodule(targetSubmoduleId)
      : getUnassignedLectures()

    const oldSubmoduleId = draggedLecture.submodule_id
    const targetIndex = targetLecture
      ? targetLectures.findIndex((l) => l.id === targetLecture.id)
      : targetLectures.length

    let newLectures = lectures.filter((l) => l.id !== draggedLecture.id)
    const updatedDraggedLecture = { ...draggedLecture, submodule_id: targetSubmoduleId }

    const insertIndex = newLectures.findIndex(
      (l) => l.submodule_id === targetSubmoduleId && l.display_order >= targetIndex
    )
    if (insertIndex === -1) {
      newLectures.push(updatedDraggedLecture)
    } else {
      newLectures.splice(insertIndex, 0, updatedDraggedLecture)
    }

    const submodulesToUpdate = new Set([oldSubmoduleId, targetSubmoduleId])
    submodulesToUpdate.forEach((smId) => {
      let order = 0
      newLectures = newLectures.map((l) => {
        if (l.submodule_id === smId) {
          return { ...l, display_order: order++ }
        }
        return l
      })
    })

    setLectures(newLectures)

    await supabase
      .from('lectures')
      .update({ submodule_id: targetSubmoduleId, display_order: targetIndex })
      .eq('id', draggedLecture.id)

    setDraggedLecture(null)
  }

  const handleLectureDropAtIndex = async (e, targetSubmoduleId, targetIndex) => {
    e.preventDefault()
    if (!draggedLecture) return

    const oldSubmoduleId = draggedLecture.submodule_id
    const isFromSameSubmodule = oldSubmoduleId === targetSubmoduleId

    const targetLectures = targetSubmoduleId
      ? getLecturesForSubmodule(targetSubmoduleId)
      : getUnassignedLectures()

    const oldIndex = targetLectures.findIndex((l) => l.id === draggedLecture.id)

    if (isFromSameSubmodule && (oldIndex === targetIndex || oldIndex === targetIndex - 1)) {
      setDraggedLecture(null)
      return
    }

    let newIndex = targetIndex
    if (isFromSameSubmodule && oldIndex < targetIndex) {
      newIndex = targetIndex - 1
    }

    let newLectures = lectures.filter((l) => l.id !== draggedLecture.id)
    const updatedDraggedLecture = { ...draggedLecture, submodule_id: targetSubmoduleId }

    const sameSMLectures = newLectures.filter((l) => l.submodule_id === targetSubmoduleId)
    const insertAfter = sameSMLectures[newIndex - 1]

    if (insertAfter) {
      const globalInsertIndex = newLectures.findIndex((l) => l.id === insertAfter.id) + 1
      newLectures.splice(globalInsertIndex, 0, updatedDraggedLecture)
    } else {
      const firstOfSubmodule = newLectures.findIndex((l) => l.submodule_id === targetSubmoduleId)
      if (firstOfSubmodule === -1) {
        newLectures.push(updatedDraggedLecture)
      } else {
        newLectures.splice(firstOfSubmodule, 0, updatedDraggedLecture)
      }
    }

    const submodulesToUpdate = new Set([oldSubmoduleId, targetSubmoduleId])
    submodulesToUpdate.forEach((smId) => {
      let order = 0
      newLectures = newLectures.map((l) => {
        if (l.submodule_id === smId) {
          return { ...l, display_order: order++ }
        }
        return l
      })
    })

    setLectures(newLectures)

    await supabase
      .from('lectures')
      .update({ submodule_id: targetSubmoduleId, display_order: newIndex })
      .eq('id', draggedLecture.id)

    setDraggedLecture(null)
  }

  const handleLectureDropToSubmodule = async (e, targetSubmoduleId) => {
    e.preventDefault()
    if (!draggedLecture || draggedLecture.submodule_id === targetSubmoduleId) {
      setDraggedLecture(null)
      return
    }

    const targetLectures = targetSubmoduleId
      ? getLecturesForSubmodule(targetSubmoduleId)
      : getUnassignedLectures()
    const maxOrder = Math.max(0, ...targetLectures.map((l) => l.display_order || 0))

    setLectures((prev) =>
      prev.map((l) =>
        l.id === draggedLecture.id
          ? { ...l, submodule_id: targetSubmoduleId, display_order: maxOrder + 1 }
          : l
      )
    )

    await supabase
      .from('lectures')
      .update({ submodule_id: targetSubmoduleId, display_order: maxOrder + 1 })
      .eq('id', draggedLecture.id)

    setDraggedLecture(null)
  }

  // Unassigned lectures drop handlers
  const handleUnassignedDropZoneDragEnter = (e, index) => {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedLecture) return

    const unassigned = getUnassignedLectures()
    const draggedIdx = unassigned.findIndex((l) => l.id === draggedLecture.id)
    const isFromUnassigned = !draggedLecture.submodule_id

    if (!isFromUnassigned || (draggedIdx !== index && draggedIdx !== index - 1)) {
      setUnassignedDropIndex(index)
    }
  }

  const handleUnassignedDropZoneDragOver = (e, index) => {
    e.preventDefault()
    e.stopPropagation()
    if (!draggedLecture) return

    const unassigned = getUnassignedLectures()
    const draggedIdx = unassigned.findIndex((l) => l.id === draggedLecture.id)
    const isFromUnassigned = !draggedLecture.submodule_id

    if (!isFromUnassigned || (draggedIdx !== index && draggedIdx !== index - 1)) {
      setUnassignedDropIndex(index)
    }
  }

  const handleUnassignedDropAtIndex = async (e, targetIndex) => {
    e.preventDefault()
    e.stopPropagation()
    setUnassignedDropIndex(null)
    await handleLectureDropAtIndex(e, null, targetIndex)
  }

  const handleUnassignedDrop = async (e) => {
    e.preventDefault()
    if (!draggedLecture || !draggedLecture.submodule_id) {
      setDraggedLecture(null)
      return
    }

    const unassigned = getUnassignedLectures()
    const maxOrder = Math.max(0, ...unassigned.map((l) => l.display_order || 0))

    setLectures((prev) =>
      prev.map((l) =>
        l.id === draggedLecture.id
          ? { ...l, submodule_id: null, display_order: maxOrder + 1 }
          : l
      )
    )

    await supabase
      .from('lectures')
      .update({ submodule_id: null, display_order: maxOrder + 1 })
      .eq('id', draggedLecture.id)

    setDraggedLecture(null)
  }

  const unassignedLectures = getUnassignedLectures()

  // If a lecture is selected, show the lecture view
  if (selectedLecture) {
    return (
      <LectureView
        lecture={selectedLecture}
        module={module}
        user={user}
        onBack={() => setSelectedLecture(null)}
      />
    )
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-secondary hover:text-primary mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to modules
        </button>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
              style={{ backgroundColor: `${module.color}15`, color: module.color }}
            >
              {module.abbreviation}
            </div>
            <h1 className="text-2xl font-bold text-primary">{module.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateSubmoduleModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium text-primary transition-colors"
            >
              <FolderPlus className="w-5 h-5" />
              Add Submodule
            </button>
            <button
              onClick={() => {
                setCreateLectureForSubmodule(null)
                setShowCreateLectureModal(true)
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-blue-600 rounded-xl font-medium text-white transition-colors"
            >
              <Plus className="w-5 h-5" />
              Add Lecture
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      ) : submodules.length === 0 && lectures.length === 0 ? (
        <div className="text-center py-20">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-2xl mb-4">
            <FileText className="w-8 h-8 text-secondary" />
          </div>
          <h2 className="text-xl font-semibold text-primary mb-2">No lectures yet</h2>
          <p className="text-secondary mb-6 max-w-md mx-auto">
            Add lectures directly, or create submodules to organise them.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setShowCreateSubmoduleModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium text-primary transition-colors"
            >
              <FolderPlus className="w-5 h-5" />
              Add Submodule
            </button>
            <button
              onClick={() => {
                setCreateLectureForSubmodule(null)
                setShowCreateLectureModal(true)
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-blue-600 rounded-xl font-medium text-white transition-colors"
            >
              <Plus className="w-5 h-5" />
              Add Lecture
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Submodules */}
          {submodules.length > 0 && (
            <div className="flex flex-col">
              {/* Drop zone at top */}
              <div
                onDragEnter={(e) => handleSubmoduleDropZoneDragEnter(e, 0)}
                onDragOver={(e) => handleSubmoduleDropZoneDragOver(e, 0)}
                onDrop={(e) => handleSubmoduleDropAtIndex(e, 0)}
                className={`h-3 transition-all duration-150 rounded-full mx-1 ${
                  submoduleDropIndex === 0 ? 'bg-accent h-1 my-2' : ''
                }`}
              />

              {submodules.map((submodule, index) => (
                <div key={submodule.id} onDragEnd={handleSubmoduleDragEnd}>
                  <SubmoduleSection
                    submodule={submodule}
                    lectures={getLecturesForSubmodule(submodule.id)}
                    onDeleteSubmodule={handleDeleteSubmodule}
                    onEditSubmodule={setEditingSubmodule}
                    onDeleteLecture={handleDeleteLecture}
                    onEditLecture={setEditingLecture}
                    onAddLecture={(submoduleId) => {
                      setCreateLectureForSubmodule(submoduleId)
                      setShowCreateLectureModal(true)
                    }}
                    onDragStart={handleSubmoduleDragStart}
                    onDrop={handleSubmoduleDrop}
                    onLectureDragStart={handleLectureDragStart}
                    onLectureDrop={handleLectureDrop}
                    onLectureDropToSubmodule={handleLectureDropToSubmodule}
                    onLectureDropAtIndex={handleLectureDropAtIndex}
                    draggedLecture={draggedLecture}
                    draggedSubmodule={draggedSubmodule}
                    onLectureClick={setSelectedLecture}
                  />
                  {/* Drop zone after each submodule */}
                  <div
                    onDragEnter={(e) => handleSubmoduleDropZoneDragEnter(e, index + 1)}
                    onDragOver={(e) => handleSubmoduleDropZoneDragOver(e, index + 1)}
                    onDrop={(e) => handleSubmoduleDropAtIndex(e, index + 1)}
                    className={`h-3 transition-all duration-150 rounded-full mx-1 ${
                      submoduleDropIndex === index + 1 ? 'bg-accent h-1 my-2' : ''
                    }`}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Unassigned Lectures */}
          {unassignedLectures.length > 0 && (
            <div
              className="flex flex-col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleUnassignedDrop}
            >
              {submodules.length > 0 && (
                <h3 className="text-sm font-medium text-secondary uppercase tracking-wider mb-3">
                  Unassigned Lectures
                </h3>
              )}

              {/* Drop zone at top */}
              <div
                onDragEnter={(e) => handleUnassignedDropZoneDragEnter(e, 0)}
                onDragOver={(e) => handleUnassignedDropZoneDragOver(e, 0)}
                onDrop={(e) => handleUnassignedDropAtIndex(e, 0)}
                className={`h-2 transition-all duration-150 rounded-full mx-1 ${
                  unassignedDropIndex === 0 ? 'bg-accent h-1 my-1' : ''
                }`}
              />

              {unassignedLectures.map((lecture, index) => (
                <div key={lecture.id} onDragEnd={handleLectureDragEnd}>
                  <div
                    draggable
                    onClick={() => setSelectedLecture(lecture)}
                    onDragStart={(e) => handleLectureDragStart(e, lecture)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleLectureDrop(e, lecture, null)}
                    className={`group flex items-start bg-surface rounded-lg border transition-all cursor-pointer hover:shadow-sm min-h-[44px] ${
                      draggedLecture?.id === lecture.id
                        ? 'opacity-50 border-accent'
                        : 'border-divider hover:border-gray-300'
                    }`}
                  >
                    {/* Column 1: Drag handle - 40px fixed */}
                    <div className="w-10 flex-shrink-0 flex justify-center pt-3">
                      <div className="text-secondary hover:text-primary">
                        <GripVertical className="w-4 h-4" />
                      </div>
                    </div>

                    {/* Column 2: File icon - 24px fixed */}
                    <div className="w-6 flex-shrink-0 pt-3">
                      <FileText className="w-4 h-4 text-secondary" />
                    </div>

                    {/* Column 3: Lecture title - fixed max-width 400px, left-aligned, wraps to new line */}
                    <div className="w-[400px] flex-shrink py-3 pr-4">
                      <span className="text-primary leading-snug block">
                        {lecture.title}
                      </span>
                    </div>

                    {/* Column 4: Action buttons - remaining space, right-aligned */}
                    <div className="flex-1 flex items-center justify-end gap-0.5 pr-2 pt-2.5 opacity-0 group-hover:opacity-100 transition-all">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingLecture(lecture)
                        }}
                        className="p-1.5 text-secondary hover:text-accent hover:bg-blue-50 rounded transition-all"
                        title="Edit lecture"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteLecture(lecture.id)
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
                    onDragEnter={(e) => handleUnassignedDropZoneDragEnter(e, index + 1)}
                    onDragOver={(e) => handleUnassignedDropZoneDragOver(e, index + 1)}
                    onDrop={(e) => handleUnassignedDropAtIndex(e, index + 1)}
                    className={`h-2 transition-all duration-150 rounded-full mx-1 ${
                      unassignedDropIndex === index + 1 ? 'bg-accent h-1 my-1' : ''
                    }`}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Drop zone for unassigning lectures */}
          {draggedLecture && draggedLecture.submodule_id && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleUnassignedDrop}
              className="p-6 border-2 border-dashed border-divider rounded-xl text-center text-secondary"
            >
              Drop here to unassign from submodule
            </div>
          )}
        </div>
      )}

      {/* Create Lecture Modal */}
      {showCreateLectureModal && (
        <CreateLectureModal
          onClose={() => {
            setShowCreateLectureModal(false)
            setCreateLectureForSubmodule(null)
          }}
          onCreate={handleCreateLecture}
        />
      )}

      {/* Create Submodule Modal */}
      {showCreateSubmoduleModal && (
        <CreateSubmoduleModal
          onClose={() => setShowCreateSubmoduleModal(false)}
          onCreate={handleCreateSubmodule}
        />
      )}

      {/* Edit Submodule Modal */}
      {editingSubmodule && (
        <EditSubmoduleModal
          submodule={editingSubmodule}
          onClose={() => setEditingSubmodule(null)}
          onSave={handleEditSubmodule}
        />
      )}

      {/* Edit Lecture Modal */}
      {editingLecture && (
        <EditLectureModal
          lecture={editingLecture}
          onClose={() => setEditingLecture(null)}
          onSave={handleEditLecture}
        />
      )}
    </div>
  )
}
