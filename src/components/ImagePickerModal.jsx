import { useState, useEffect, useCallback } from 'react'
import { X, Search, ChevronLeft, ChevronRight, Image, FileImage } from 'lucide-react'

export function ImagePickerModal({
  isOpen,
  onClose,
  thumbnails,
  thumbnailsLoading,
  existingImages,
  onSelectSlide,
  onSelectExisting,
  currentKey
}) {
  const [activeTab, setActiveTab] = useState('slides')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [previewSize, setPreviewSize] = useState('large')

  // Filter thumbnails by search query
  const filteredThumbnails = thumbnails.filter(thumb => {
    if (!searchQuery.trim()) return true
    return thumb.text.includes(searchQuery.toLowerCase())
  })

  // Get existing images as array (excluding current point)
  const existingImageEntries = Object.entries(existingImages || {}).filter(
    ([key]) => key !== currentKey
  )

  // Reset selection when modal opens or thumbnails change
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0)
      setSearchQuery('')
    }
  }, [isOpen])

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!isOpen) return

    const items = activeTab === 'slides' ? filteredThumbnails : existingImageEntries
    if (items.length === 0) return

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(0, prev - 1))
        break
      case 'ArrowRight':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(items.length - 1, prev + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(0, prev - 4))
        break
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(items.length - 1, prev + 4))
        break
      case 'Enter':
        e.preventDefault()
        if (activeTab === 'slides') {
          onSelectSlide(filteredThumbnails[selectedIndex].pageNum)
        } else {
          onSelectExisting(existingImageEntries[selectedIndex][0])
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [isOpen, activeTab, filteredThumbnails, existingImageEntries, selectedIndex, onSelectSlide, onSelectExisting, onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Ensure selectedIndex is valid when filter changes
  useEffect(() => {
    const items = activeTab === 'slides' ? filteredThumbnails : existingImageEntries
    if (selectedIndex >= items.length) {
      setSelectedIndex(Math.max(0, items.length - 1))
    }
  }, [filteredThumbnails, existingImageEntries, activeTab, selectedIndex])

  if (!isOpen) return null

  const selectedItem = activeTab === 'slides'
    ? filteredThumbnails[selectedIndex]
    : existingImageEntries[selectedIndex]

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Insert Image</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => { setActiveTab('slides'); setSelectedIndex(0) }}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'slides'
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileImage className="w-4 h-4 inline mr-2" />
            From Slides ({thumbnails.length})
          </button>
          <button
            onClick={() => { setActiveTab('notes'); setSelectedIndex(0) }}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'notes'
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Image className="w-4 h-4 inline mr-2" />
            From Notes ({existingImageEntries.length})
          </button>
        </div>

        {/* Search (only for slides) */}
        {activeTab === 'slides' && (
          <div className="px-6 py-3 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search slides by text content..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Thumbnail grid */}
          <div className="w-1/2 overflow-y-auto p-4 border-r border-gray-100">
            {thumbnailsLoading && activeTab === 'slides' ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                  <p className="text-sm text-gray-500">Loading slides...</p>
                </div>
              </div>
            ) : activeTab === 'slides' ? (
              <div className="grid grid-cols-3 gap-2">
                {filteredThumbnails.map((thumb, index) => (
                  <button
                    key={thumb.pageNum}
                    onClick={() => setSelectedIndex(index)}
                    onDoubleClick={() => onSelectSlide(thumb.pageNum)}
                    className={`relative aspect-[4/3] bg-gray-100 rounded-lg overflow-hidden border-2 transition-all ${
                      selectedIndex === index
                        ? 'border-indigo-600 ring-2 ring-indigo-200'
                        : 'border-transparent hover:border-gray-300'
                    }`}
                  >
                    <img
                      src={thumb.dataUrl}
                      alt={`Page ${thumb.pageNum}`}
                      className="w-full h-full object-contain"
                    />
                    <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                      {thumb.pageNum}
                    </span>
                  </button>
                ))}
                {filteredThumbnails.length === 0 && (
                  <div className="col-span-3 text-center py-8 text-gray-500">
                    {searchQuery ? 'No slides match your search' : 'No slides available'}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {existingImageEntries.map(([key, imageData], index) => (
                  <button
                    key={key}
                    onClick={() => setSelectedIndex(index)}
                    onDoubleClick={() => onSelectExisting(key)}
                    className={`relative aspect-[4/3] bg-gray-100 rounded-lg overflow-hidden border-2 transition-all ${
                      selectedIndex === index
                        ? 'border-indigo-600 ring-2 ring-indigo-200'
                        : 'border-transparent hover:border-gray-300'
                    }`}
                  >
                    <img
                      src={imageData.dataUrl}
                      alt={`Image from ${key}`}
                      className="w-full h-full object-contain"
                    />
                    <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                      {key}
                    </span>
                  </button>
                ))}
                {existingImageEntries.length === 0 && (
                  <div className="col-span-3 text-center py-8 text-gray-500">
                    No images have been added to notes yet
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Preview pane */}
          <div className="w-1/2 p-4 flex flex-col">
            <div className="flex-1 bg-gray-50 rounded-lg flex items-center justify-center overflow-hidden">
              {selectedItem ? (
                <img
                  src={activeTab === 'slides' ? selectedItem.dataUrl : selectedItem[1].dataUrl}
                  alt="Preview"
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="text-center text-gray-400">
                  <Image className="w-12 h-12 mx-auto mb-2" />
                  <p>Select an image to preview</p>
                </div>
              )}
            </div>

            {/* Preview info */}
            {selectedItem && (
              <div className="mt-3 text-center">
                <p className="text-sm text-gray-600">
                  {activeTab === 'slides'
                    ? `Slide ${selectedItem.pageNum} of ${thumbnails.length}`
                    : `Point ${selectedItem[0]}`
                  }
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500">
              Use arrow keys to navigate, Enter to select
            </span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (activeTab === 'slides' && filteredThumbnails[selectedIndex]) {
                  onSelectSlide(filteredThumbnails[selectedIndex].pageNum)
                } else if (activeTab === 'notes' && existingImageEntries[selectedIndex]) {
                  onSelectExisting(existingImageEntries[selectedIndex][0])
                }
              }}
              disabled={!selectedItem}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {activeTab === 'slides' ? 'Select & Crop' : 'Use This Image'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
