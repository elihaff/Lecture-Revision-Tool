import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { X, Search, ChevronLeft, ChevronRight, Image, FileImage, Link } from 'lucide-react'
import { stripHtml } from '../lib/htmlSanitizer'

export function ImagePickerModal({
  isOpen,
  onClose,
  thumbnails,
  pdfPageCount = 0,
  loadSlideThumbnail = null,
  thumbnailsLoading,
  existingImages,
  onSelectSlide,
  onSelectExisting,
  onUploadImages,
  uploadingImages = false,
  currentKey,
  notes,
  getSectionImage,
  getPointImages,
  getPointImage,
  getPointImageKey,
  getFigureNumberByKey
}) {
  const [activeTab, setActiveTab] = useState('slides')
  const [slidesSelectionMode, setSlidesSelectionMode] = useState('slides') // 'slides' | 'link-existing'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [previewSize, setPreviewSize] = useState('large')
  const [visibleSlideCount, setVisibleSlideCount] = useState(12)
  const [lazySlidesByPage, setLazySlidesByPage] = useState({})
  const [loadingPages, setLoadingPages] = useState({})
  const [failedPages, setFailedPages] = useState({})
  const uploadInputRef = useRef(null)
  const slidesScrollRef = useRef(null)
  const lazySlidesByPageRef = useRef({})
  const loadingPagesRef = useRef({})
  const failedPagesRef = useRef({})

  // Filter slide thumbnails by search query (exclude uploaded images)
  const slideThumbnails = thumbnails.filter(thumb => !thumb.id?.startsWith('uploaded-'))
  const filteredThumbnails = slideThumbnails.filter(thumb => {
    if (!searchQuery.trim()) return true
    return thumb.text?.includes(searchQuery.toLowerCase())
  })

  // Get uploaded images only
  const uploadedImages = thumbnails.filter(thumb => thumb.id?.startsWith('uploaded-'))

  const availableExistingImages = useMemo(() => {
    const allImages = []
    let figNum = 1
    const sections = notes?.notes || []
    const shouldExcludeKey = (key) => key === currentKey || key.startsWith(`${currentKey}::`)

    sections.forEach((section, sIdx) => {
      const sectionImg = getSectionImage ? getSectionImage(sIdx) : null
      if (sectionImg) {
        const sectionKey = `section-${sIdx}`
        const canonicalFigNum = getFigureNumberByKey ? getFigureNumberByKey(sectionKey) : null
        allImages.push({
          key: sectionKey,
          image: sectionImg,
          figNum: canonicalFigNum ?? figNum++,
          label: stripHtml(String(section.section || 'Section')).replace(/\s+/g, ' ').trim(),
          type: 'section'
        })
      }

      const points = section.points || []
      points.forEach((point, pIdx) => {
        const pointImgs = getPointImages
          ? getPointImages(sIdx, pIdx)
          : (() => {
            const single = getPointImage ? getPointImage(sIdx, pIdx) : null
            return single ? [single] : []
          })()
        pointImgs.forEach((pointImg, pointImageIndex) => {
          const pointKeyBase = getPointImageKey ? getPointImageKey(sIdx, pIdx) : `${sIdx}-${pIdx}`
          const pointKey = `${pointKeyBase}::${pointImageIndex}`
          const canonicalFigNum = getFigureNumberByKey ? getFigureNumberByKey(pointKey) : null
          allImages.push({
            key: pointKey,
            image: pointImg,
            figNum: canonicalFigNum ?? figNum++,
            label: stripHtml(String(point || '')).replace(/\s+/g, ' ').trim(),
            type: 'point'
          })
        })
      })
    })

    return allImages.filter((img) => !shouldExcludeKey(img.key))
  }, [notes, getSectionImage, getPointImages, getPointImage, getPointImageKey, getFigureNumberByKey, currentKey])

  // Reset selection when modal opens or thumbnails change
  useEffect(() => {
    if (isOpen) {
      setActiveTab('slides')
      setSlidesSelectionMode('slides')
      setSelectedIndex(0)
      setSearchQuery('')
      setVisibleSlideCount(12)
      setLazySlidesByPage({})
      setLoadingPages({})
      setFailedPages({})
      lazySlidesByPageRef.current = {}
      loadingPagesRef.current = {}
      failedPagesRef.current = {}
    }
  }, [isOpen])

  useEffect(() => {
    lazySlidesByPageRef.current = lazySlidesByPage
  }, [lazySlidesByPage])

  useEffect(() => {
    loadingPagesRef.current = loadingPages
  }, [loadingPages])

  useEffect(() => {
    failedPagesRef.current = failedPages
  }, [failedPages])

  const loadSlideWithTimeout = useCallback((pageNum, timeoutMs = 15000) => {
    return new Promise((resolve, reject) => {
      let settled = false
      const timeoutId = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('Thumbnail load timeout'))
      }, timeoutMs)

      Promise.resolve(loadSlideThumbnail(pageNum))
        .then((result) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          resolve(result || null)
        })
        .catch((error) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          reject(error)
        })
    })
  }, [loadSlideThumbnail])

  const triggerLoadPage = useCallback(async (pageNum) => {
    if (!loadSlideThumbnail) return null
    if (!pageNum) return null
    if (lazySlidesByPageRef.current[pageNum]) return lazySlidesByPageRef.current[pageNum]
    if (loadingPagesRef.current[pageNum]) return null

    loadingPagesRef.current = { ...loadingPagesRef.current, [pageNum]: true }
    setLoadingPages((prev) => (prev[pageNum] ? prev : { ...prev, [pageNum]: true }))

    if (failedPagesRef.current[pageNum]) {
      const nextFailed = { ...failedPagesRef.current }
      delete nextFailed[pageNum]
      failedPagesRef.current = nextFailed
      setFailedPages(nextFailed)
    }

    try {
      const loaded = await loadSlideWithTimeout(pageNum)
      if (!loaded) {
        throw new Error('Slide thumbnail unavailable')
      }
      lazySlidesByPageRef.current = { ...lazySlidesByPageRef.current, [pageNum]: loaded }
      setLazySlidesByPage((prev) => ({ ...prev, [pageNum]: loaded }))
      return loaded
    } catch {
      failedPagesRef.current = { ...failedPagesRef.current, [pageNum]: true }
      setFailedPages((prev) => ({ ...prev, [pageNum]: true }))
      return null
    } finally {
      const nextLoading = { ...loadingPagesRef.current }
      delete nextLoading[pageNum]
      loadingPagesRef.current = nextLoading
      setLoadingPages((prev) => {
        if (!prev[pageNum]) return prev
        const next = { ...prev }
        delete next[pageNum]
        return next
      })
    }
  }, [loadSlideThumbnail, loadSlideWithTimeout])

  const allSlidePages = useMemo(() => {
    if (pdfPageCount > 0) {
      return Array.from({ length: pdfPageCount }, (_, idx) => idx + 1)
    }
    return slideThumbnails.map((thumb) => thumb.pageNum)
  }, [pdfPageCount, slideThumbnails])

  const visiblePageNumbers = useMemo(() => {
    return allSlidePages.slice(0, visibleSlideCount)
  }, [allSlidePages, visibleSlideCount])

  const visibleSlides = useMemo(() => {
    return visiblePageNumbers.map((pageNum) => lazySlidesByPage[pageNum] || null)
  }, [visiblePageNumbers, lazySlidesByPage])

  const slideItemsForSelection = useMemo(() => {
    if (activeTab !== 'slides' || slidesSelectionMode !== 'slides') return []
    if (pdfPageCount > 0) {
      return visiblePageNumbers
    }
    return filteredThumbnails
  }, [activeTab, slidesSelectionMode, pdfPageCount, visiblePageNumbers, filteredThumbnails])

  useEffect(() => {
    if (!isOpen || activeTab !== 'slides' || slidesSelectionMode !== 'slides') return
    if (!loadSlideThumbnail) return

    let cancelled = false
    const loadVisible = async () => {
      // Keep open interaction responsive by loading a small batch and yielding.
      // Continue in the same effect cycle to avoid state-churn cancellation loops.
      while (!cancelled) {
        const toLoad = visiblePageNumbers
          .filter((pageNum) =>
            !lazySlidesByPageRef.current[pageNum] &&
            !loadingPagesRef.current[pageNum] &&
            !failedPagesRef.current[pageNum]
          )
          .slice(0, 3)

        if (toLoad.length === 0) break

        for (const pageNum of toLoad) {
          if (cancelled) break
          await triggerLoadPage(pageNum)
          // Yield between pages so touch UI stays responsive on iPad.
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
    }

    loadVisible()
    return () => { cancelled = true }
  }, [isOpen, activeTab, slidesSelectionMode, visiblePageNumbers, loadSlideThumbnail, triggerLoadPage])

  useEffect(() => {
    if (!isOpen || activeTab !== 'slides' || slidesSelectionMode !== 'slides') return
    // Seed from already available thumbnails.
    if (slideThumbnails.length === 0) return
    setLazySlidesByPage((prev) => {
      const next = { ...prev }
      slideThumbnails.forEach((thumb) => {
        if (thumb?.pageNum && !next[thumb.pageNum]) {
          next[thumb.pageNum] = thumb
        }
      })
      lazySlidesByPageRef.current = next
      return next
    })
  }, [isOpen, activeTab, slidesSelectionMode, slideThumbnails])

  useEffect(() => {
    if (!isOpen || activeTab !== 'slides' || slidesSelectionMode !== 'slides') return
    const pageNum = visiblePageNumbers[selectedIndex]
    if (!pageNum || !loadSlideThumbnail) return
    if (lazySlidesByPageRef.current[pageNum] || loadingPagesRef.current[pageNum]) return

    let cancelled = false
    const loadSelected = async () => {
      if (cancelled) return
      await triggerLoadPage(pageNum)
    }
    loadSelected()
    return () => { cancelled = true }
  }, [isOpen, activeTab, slidesSelectionMode, selectedIndex, visiblePageNumbers, loadSlideThumbnail, triggerLoadPage])

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!isOpen) return

    const items = activeTab === 'slides'
      ? (slidesSelectionMode === 'slides' ? slideItemsForSelection : availableExistingImages)
      : uploadedImages
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
        if (activeTab === 'slides' && slidesSelectionMode === 'slides') {
          const selectedPageNum = pdfPageCount > 0
            ? visiblePageNumbers[selectedIndex]
            : filteredThumbnails[selectedIndex]?.pageNum
          if (selectedPageNum) {
            onSelectSlide(selectedPageNum)
          }
        } else if (activeTab === 'slides' && slidesSelectionMode === 'link-existing') {
          const selectedExisting = availableExistingImages[selectedIndex]
          if (onSelectExisting && selectedExisting) {
            onSelectExisting(selectedExisting.key)
          }
        } else {
          // For uploaded images, call onSelectSlide with the uploaded image index in original thumbnails array
          const uploadedImg = uploadedImages[selectedIndex]
          if (!uploadedImg) break
          const originalIndex = thumbnails.findIndex(t => t.id === uploadedImg.id)
          if (originalIndex >= 0) {
            onSelectSlide(originalIndex + 1) // pageNum is 1-indexed
          }
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [isOpen, activeTab, slidesSelectionMode, slideItemsForSelection, availableExistingImages, uploadedImages, selectedIndex, onSelectSlide, onSelectExisting, thumbnails, onClose, visiblePageNumbers, pdfPageCount, filteredThumbnails])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Ensure selectedIndex is valid when filter changes
  useEffect(() => {
    const items = activeTab === 'slides'
      ? (slidesSelectionMode === 'slides' ? slideItemsForSelection : availableExistingImages)
      : uploadedImages
    if (selectedIndex >= items.length) {
      setSelectedIndex(Math.max(0, items.length - 1))
    }
  }, [slideItemsForSelection, availableExistingImages, uploadedImages, activeTab, slidesSelectionMode, selectedIndex])

  const selectedSlideItem = useMemo(() => {
    if (!(activeTab === 'slides' && slidesSelectionMode === 'slides')) return null
    if (pdfPageCount > 0) {
      const pageNum = visiblePageNumbers[selectedIndex]
      return pageNum ? (lazySlidesByPage[pageNum] || null) : null
    }
    return filteredThumbnails[selectedIndex] || null
  }, [activeTab, slidesSelectionMode, pdfPageCount, selectedIndex, visiblePageNumbers, lazySlidesByPage, filteredThumbnails])

  const selectedItem = activeTab === 'slides'
    ? selectedSlideItem
    : uploadedImages[selectedIndex]

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl md:max-w-5xl lg:max-w-6xl max-h-[90vh] flex flex-col">
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
            onClick={() => { setActiveTab('slides'); setSlidesSelectionMode('slides'); setSelectedIndex(0) }}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'slides'
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileImage className="w-4 h-4 inline mr-2" />
            From Slides ({pdfPageCount > 0 ? pdfPageCount : slideThumbnails.length})
          </button>
          <button
            onClick={() => { setActiveTab('uploaded'); setSelectedIndex(0) }}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'uploaded'
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Image className="w-4 h-4 inline mr-2" />
            Uploaded Images ({uploadedImages.length})
          </button>
        </div>

        {/* Slides mode controls */}
        {activeTab === 'slides' && (
          <div className="px-6 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => {
                  setSlidesSelectionMode('slides')
                  setSelectedIndex(0)
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  slidesSelectionMode === 'slides'
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <FileImage className="w-3.5 h-3.5 inline mr-1" />
                Pick from slides
              </button>
              <button
                onClick={() => {
                  setSlidesSelectionMode('link-existing')
                  setSelectedIndex(0)
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  slidesSelectionMode === 'link-existing'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Link className="w-3.5 h-3.5 inline mr-1" />
                Link already inserted image
              </button>
            </div>

            {slidesSelectionMode === 'slides' && (
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
            )}
          </div>
        )}

        {/* Uploaded mode controls */}
        {activeTab === 'uploaded' && (
          <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm text-gray-600">Upload additional images from your device.</p>
            <div>
              <input
                type="file"
                ref={uploadInputRef}
                onChange={async (e) => {
                  const files = e.target.files
                  if (files && files.length > 0 && onUploadImages) {
                    await onUploadImages(files)
                  }
                  e.target.value = ''
                }}
                accept="image/*"
                multiple
                className="hidden"
              />
              <button
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploadingImages}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white transition-colors"
              >
                {uploadingImages ? 'Uploading...' : 'Upload Images'}
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Thumbnail grid */}
          <div
            ref={slidesScrollRef}
            onScroll={(e) => {
              if (!(activeTab === 'slides' && slidesSelectionMode === 'slides')) return
              const el = e.currentTarget
              const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 120
              if (nearBottom && visibleSlideCount < allSlidePages.length) {
                setVisibleSlideCount((prev) => Math.min(prev + 12, allSlidePages.length))
              }
            }}
            className={(activeTab === 'slides' && slidesSelectionMode === 'link-existing') ? 'w-full overflow-y-auto p-4' : 'w-full md:basis-[42%] md:shrink-0 overflow-y-auto p-4 border-r border-gray-100'}
          >
            {thumbnailsLoading && activeTab === 'slides' && slidesSelectionMode === 'slides' ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                  <p className="text-sm text-gray-500">Loading slides...</p>
                </div>
              </div>
            ) : activeTab === 'slides' && slidesSelectionMode === 'link-existing' ? (
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  Select an image that's already inserted in your notes to reference it at this bullet point.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {availableExistingImages.length === 0 ? (
                    <div className="col-span-full text-center py-8 text-gray-500">
                      No images available to link. Insert images into other bullet points first.
                    </div>
                  ) : (
                    availableExistingImages.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => {
                          if (onSelectExisting) {
                            onSelectExisting(item.key)
                          }
                        }}
                        className="border-2 border-gray-200 rounded-lg p-4 hover:border-green-500 hover:bg-green-50 transition-all text-left group"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0">
                            <img
                              src={item.image.dataUrl}
                              alt={`Fig ${item.figNum}`}
                              className="w-24 h-24 object-contain border border-gray-200 rounded"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-green-600 mb-1">
                              Fig {item.figNum}
                              {item.image.isUploaded ? (
                                <span className="text-gray-500 ml-1 text-xs">(Uploaded)</span>
                              ) : item.image.pageNum && (
                                <span className="text-gray-500 ml-1 text-xs">(Slide {item.image.pageNum})</span>
                              )}
                            </div>
                            <div className="text-sm text-gray-700 line-clamp-2">
                              {item.label}
                            </div>
                            <div className="mt-2 text-xs text-gray-500">
                              {item.type === 'section' ? 'Section heading' : 'Bullet point'}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : activeTab === 'slides' ? (
              <div className="grid grid-cols-3 gap-2">
                {(pdfPageCount > 0 ? visibleSlides : filteredThumbnails).map((thumb, index) => (
                  <button
                    key={thumb?.pageNum || `page-${visiblePageNumbers[index] || index}`}
                    onClick={() => {
                      const pageNum = thumb?.pageNum || visiblePageNumbers[index]
                      if (pageNum && failedPages[pageNum]) {
                        triggerLoadPage(pageNum)
                        return
                      }
                      setSelectedIndex(index)
                    }}
                    onDoubleClick={() => {
                      const pageNum = thumb?.pageNum || visiblePageNumbers[index]
                      if (pageNum) onSelectSlide(pageNum)
                    }}
                    className={`relative aspect-[4/3] bg-gray-100 rounded-lg overflow-hidden border-2 transition-all ${
                      selectedIndex === index
                        ? 'border-indigo-600 ring-2 ring-indigo-200'
                        : 'border-transparent hover:border-gray-300'
                    }`}
                  >
                    {thumb?.dataUrl ? (
                      <img
                        src={thumb.dataUrl}
                        alt={`Page ${thumb.pageNum}`}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                        {(() => {
                          const pageNum = visiblePageNumbers[index]
                          if (failedPages[pageNum]) return 'Tap to retry'
                          if (loadingPages[pageNum]) return 'Loading…'
                          return `Page ${pageNum}`
                        })()}
                      </div>
                    )}
                    <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                      {thumb?.pageNum || visiblePageNumbers[index]}
                    </span>
                  </button>
                ))}
                {(pdfPageCount > 0 ? visibleSlides.length === 0 : filteredThumbnails.length === 0) && (
                  <div className="col-span-3 text-center py-8 text-gray-500">
                    {searchQuery ? 'No slides match your search' : 'No slides available'}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {uploadedImages.map((thumb, index) => (
                  <button
                    key={thumb.id}
                    onClick={() => setSelectedIndex(index)}
                    onDoubleClick={() => {
                      const originalIndex = thumbnails.findIndex(t => t.id === thumb.id)
                      onSelectSlide(originalIndex + 1)
                    }}
                    className={`relative aspect-[4/3] bg-gray-100 rounded-lg overflow-hidden border-2 transition-all ${
                      selectedIndex === index
                        ? 'border-indigo-600 ring-2 ring-indigo-200'
                        : 'border-transparent hover:border-gray-300'
                    }`}
                  >
                    <img
                      src={thumb.dataUrl}
                      alt={`Uploaded image ${index + 1}`}
                      className="w-full h-full object-contain"
                    />
                    <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                      {index + 1}
                    </span>
                  </button>
                ))}
                {uploadedImages.length === 0 && (
                  <div className="col-span-3 text-center py-8 text-gray-500">
                    No uploaded images yet.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Preview pane (hidden when linking existing image) */}
          {!(activeTab === 'slides' && slidesSelectionMode === 'link-existing') && (
          <div className="w-full md:basis-[58%] md:shrink-0 p-4 flex flex-col">
            <div className="flex-1 bg-gray-50 rounded-lg flex items-center justify-center overflow-hidden">
              {selectedItem ? (
                <img
                  src={selectedItem.dataUrl}
                  alt="Preview"
                  className="w-full h-full object-contain"
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
                    ? `Slide ${selectedItem.pageNum || visiblePageNumbers[selectedIndex] || 1} of ${pdfPageCount || slideThumbnails.length || visiblePageNumbers.length}`
                    : `Image ${selectedIndex + 1} of ${uploadedImages.length}`
                  }
                </p>
              </div>
            )}
          </div>
          )}
        </div>

        {/* Footer */}
        {!(activeTab === 'slides' && slidesSelectionMode === 'link-existing') && (
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
                if (activeTab === 'slides' && slidesSelectionMode === 'slides') {
                  const pageNum = pdfPageCount > 0
                    ? visiblePageNumbers[selectedIndex]
                    : filteredThumbnails[selectedIndex]?.pageNum
                  if (pageNum) onSelectSlide(pageNum)
                } else if (activeTab === 'uploaded' && uploadedImages[selectedIndex]) {
                  const uploadedImg = uploadedImages[selectedIndex]
                  const originalIndex = thumbnails.findIndex(t => t.id === uploadedImg.id)
                  if (originalIndex >= 0) {
                    onSelectSlide(originalIndex + 1)
                  }
                }
              }}
              disabled={!selectedItem && !(activeTab === 'slides' && slidesSelectionMode === 'slides' && Boolean(visiblePageNumbers[selectedIndex]))}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              Select & Crop
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
