import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Crop, Pencil, Circle, ArrowRight, Type, RotateCcw, Check, Loader2, Trash2, Move } from 'lucide-react'

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#000000']

export function CropModal({ isOpen, onClose, imageData, onConfirm, initialAnnotations, initialCropArea }) {
  const canvasRef = useRef(null)
  const overlayCanvasRef = useRef(null)
  const containerRef = useRef(null)

  // Tools and settings
  const [currentTool, setCurrentTool] = useState('crop')
  const [annotationColor, setAnnotationColor] = useState('#ef4444')
  const [textFontSize, setTextFontSize] = useState(20)
  const [strokeWidth, setStrokeWidth] = useState(4)

  // Crop state
  const [cropArea, setCropArea] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState(null)
  const [dragMode, setDragMode] = useState(null)

  // Annotations state
  const [annotations, setAnnotations] = useState([])
  const [currentAnnotation, setCurrentAnnotation] = useState(null)
  const [textInput, setTextInput] = useState({ show: false, x: 0, y: 0, value: '', width: 200, height: 60 })
  const textSubmittedRef = useRef(false) // Track if text was submitted via Enter

  // Editing existing text
  const [editingTextIndex, setEditingTextIndex] = useState(null) // Index of text being edited

  // Annotation selection/editing state
  const [hoveredAnnotation, setHoveredAnnotation] = useState(null) // { index, type }
  const [draggingAnnotation, setDraggingAnnotation] = useState(null) // { index, type, startX, startY }
  const [resizingText, setResizingText] = useState(null) // { index, corner, startX, startY, origWidth, origHeight, origX, origY }
  const [resizingCircle, setResizingCircle] = useState(null) // { index, startX, startY, startRadius }
  const [resizingArrow, setResizingArrow] = useState(null) // { index, endpoint: 'start'|'end', startX, startY }

  // Image dimensions
  const [displayScale, setDisplayScale] = useState(1)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [originalImage, setOriginalImage] = useState(null)

  // Load image and set up canvas
  useEffect(() => {
    if (!isOpen || !imageData?.dataUrl) {
      setImageLoaded(false)
      return
    }

    const img = new Image()
    img.onerror = () => {
      // Image failed to load - non-critical
    }
    img.onload = () => {
      const canvas = canvasRef.current
      const overlay = overlayCanvasRef.current
      if (!canvas || !overlay) {
        return
      }

      // Use larger display size - fit to 85% of viewport
      const maxWidth = Math.min(window.innerWidth * 0.85, 1200)
      const maxHeight = Math.min(window.innerHeight * 0.7, 800)
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1)

      const displayWidth = Math.round(img.width * scale)
      const displayHeight = Math.round(img.height * scale)

      // Set canvas sizes
      canvas.width = displayWidth
      canvas.height = displayHeight
      overlay.width = displayWidth
      overlay.height = displayHeight

      setDisplayScale(scale)
      setOriginalImage(img)

      // Draw image
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, displayWidth, displayHeight)

      // Restore initial crop area if provided, scaled to display size
      if (initialCropArea) {
        setCropArea({
          x: initialCropArea.x * scale,
          y: initialCropArea.y * scale,
          width: initialCropArea.width * scale,
          height: initialCropArea.height * scale
        })
      } else {
        // New crop flow: user draws crop rectangle manually.
        setCropArea(null)
      }

      // Restore initial annotations if provided, scaled to display size
      if (initialAnnotations && initialAnnotations.length > 0) {
        const scaledAnnotations = initialAnnotations.map(ann => {
          const scaled = { ...ann }
          switch (ann.type) {
            case 'draw':
              scaled.points = ann.points.map(p => ({ x: p.x * scale, y: p.y * scale }))
              scaled.strokeWidth = (ann.strokeWidth || 4) * scale
              break
            case 'circle':
              scaled.cx = ann.cx * scale
              scaled.cy = ann.cy * scale
              scaled.radius = ann.radius * scale
              scaled.strokeWidth = (ann.strokeWidth || 4) * scale
              break
            case 'arrow':
              scaled.x1 = ann.x1 * scale
              scaled.y1 = ann.y1 * scale
              scaled.x2 = ann.x2 * scale
              scaled.y2 = ann.y2 * scale
              scaled.strokeWidth = (ann.strokeWidth || 4) * scale
              break
            case 'text':
              scaled.x = ann.x * scale
              scaled.y = ann.y * scale
              scaled.fontSize = ann.fontSize * scale
              scaled.width = (ann.width || 200) * scale
              scaled.height = (ann.height || 60) * scale
              break
          }
          return scaled
        })
        setAnnotations(scaledAnnotations)
      } else {
        setAnnotations([])
      }

      setImageLoaded(true)
    }
    img.src = imageData.dataUrl
  }, [isOpen, imageData?.dataUrl, initialAnnotations, initialCropArea])

  // Redraw overlay canvas
  const redrawOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current
    if (!overlay) return

    const ctx = overlay.getContext('2d')
    ctx.clearRect(0, 0, overlay.width, overlay.height)

    // Draw semi-transparent overlay outside crop area (darker for better visibility)
    if (currentTool === 'crop' && cropArea) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
      // Top
      ctx.fillRect(0, 0, overlay.width, cropArea.y)
      // Bottom
      ctx.fillRect(0, cropArea.y + cropArea.height, overlay.width, overlay.height - cropArea.y - cropArea.height)
      // Left
      ctx.fillRect(0, cropArea.y, cropArea.x, cropArea.height)
      // Right
      ctx.fillRect(cropArea.x + cropArea.width, cropArea.y, overlay.width - cropArea.x - cropArea.width, cropArea.height)

      // Draw crop border - solid white line
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.strokeRect(cropArea.x, cropArea.y, cropArea.width, cropArea.height)

      // Draw corner handles - larger for easier grabbing
      const handleSize = 12
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#4f46e5'
      ctx.lineWidth = 2
      const corners = [
        { x: cropArea.x, y: cropArea.y },
        { x: cropArea.x + cropArea.width, y: cropArea.y },
        { x: cropArea.x, y: cropArea.y + cropArea.height },
        { x: cropArea.x + cropArea.width, y: cropArea.y + cropArea.height }
      ]
      corners.forEach(corner => {
        ctx.fillRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize)
        ctx.strokeRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize)
      })

      // Draw crop dimensions
      if (cropArea.width > 50 && cropArea.height > 30) {
        const dimText = `${Math.round(cropArea.width / displayScale)} × ${Math.round(cropArea.height / displayScale)}`
        ctx.font = '12px Arial'
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
        const textWidth = ctx.measureText(dimText).width
        ctx.fillRect(cropArea.x + cropArea.width / 2 - textWidth / 2 - 4, cropArea.y + cropArea.height - 22, textWidth + 8, 18)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(dimText, cropArea.x + cropArea.width / 2 - textWidth / 2, cropArea.y + cropArea.height - 8)
      }
    }

    // Draw annotations (skip ones that have HTML overlays when their tool is selected)
    annotations.forEach((ann, idx) => {
      // When a tool is selected, we show HTML overlays for that annotation type
      // So skip drawing them on canvas to avoid double-rendering
      const hasHtmlOverlay = (
        (currentTool === 'text' && ann.type === 'text' && !textInput.show) ||
        (currentTool === 'arrow' && ann.type === 'arrow') ||
        (currentTool === 'circle' && ann.type === 'circle') ||
        (currentTool === 'draw' && ann.type === 'draw')
      )
      // Also skip text being edited
      const isBeingEdited = ann.type === 'text' && editingTextIndex === idx
      if (!hasHtmlOverlay && !isBeingEdited) {
        drawAnnotation(ctx, ann)
      }
    })

    // Draw current annotation being created
    if (currentAnnotation) {
      drawAnnotation(ctx, currentAnnotation)
    }
  }, [cropArea, currentTool, annotations, currentAnnotation, displayScale, textInput.show, editingTextIndex])

  useEffect(() => {
    redrawOverlay()
  }, [redrawOverlay])

  // Draw a single annotation
  const drawAnnotation = (ctx, ann) => {
    ctx.strokeStyle = ann.color
    ctx.fillStyle = ann.color
    ctx.lineWidth = ann.strokeWidth || 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    switch (ann.type) {
      case 'draw':
        if (ann.points.length < 2) return
        ctx.beginPath()
        ctx.moveTo(ann.points[0].x, ann.points[0].y)
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x, ann.points[i].y)
        }
        ctx.stroke()
        break

      case 'circle':
        if (!ann.radius) return
        ctx.beginPath()
        ctx.arc(ann.cx, ann.cy, ann.radius, 0, Math.PI * 2)
        ctx.stroke()
        break

      case 'arrow':
        if (!ann.x2) return
        ctx.beginPath()
        ctx.moveTo(ann.x1, ann.y1)
        ctx.lineTo(ann.x2, ann.y2)
        ctx.stroke()

        const angle = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1)
        const headLen = 18
        ctx.beginPath()
        ctx.moveTo(ann.x2, ann.y2)
        ctx.lineTo(
          ann.x2 - headLen * Math.cos(angle - Math.PI / 6),
          ann.y2 - headLen * Math.sin(angle - Math.PI / 6)
        )
        ctx.moveTo(ann.x2, ann.y2)
        ctx.lineTo(
          ann.x2 - headLen * Math.cos(angle + Math.PI / 6),
          ann.y2 - headLen * Math.sin(angle + Math.PI / 6)
        )
        ctx.stroke()
        break

      case 'text':
        if (!ann.text) return
        ctx.font = `bold ${ann.fontSize}px Arial, sans-serif`
        const boxWidth = ann.width || 200
        const boxHeight = ann.height || 60
        const lineHeight = ann.fontSize * 1.2

        // Word wrap text
        const words = ann.text.split(' ')
        const lines = []
        let currentLine = ''

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word
          const metrics = ctx.measureText(testLine)
          if (metrics.width > boxWidth - 10 && currentLine) {
            lines.push(currentLine)
            currentLine = word
          } else {
            currentLine = testLine
          }
        }
        if (currentLine) lines.push(currentLine)

        // Draw each line (clipped to box height)
        const maxLines = Math.floor(boxHeight / lineHeight)
        const linesToDraw = lines.slice(0, maxLines)

        linesToDraw.forEach((line, i) => {
          const y = ann.y + lineHeight * (i + 1)
          // Draw text shadow for visibility
          ctx.fillStyle = 'rgba(255,255,255,0.8)'
          ctx.fillText(line, ann.x + 1, y + 1)
          ctx.fillStyle = ann.color
          ctx.fillText(line, ann.x, y)
        })
        break
    }
  }

  // Get mouse position relative to canvas
  const getMousePos = (e) => {
    const canvas = overlayCanvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }

  // Check if position is near crop handle
  const getResizeHandle = (pos) => {
    if (!cropArea) return null
    const threshold = 18
    const { x, y, width, height } = cropArea

    const corners = {
      'nw': { x, y },
      'ne': { x: x + width, y },
      'sw': { x, y: y + height },
      'se': { x: x + width, y: y + height }
    }

    for (const [handle, corner] of Object.entries(corners)) {
      if (Math.abs(pos.x - corner.x) < threshold && Math.abs(pos.y - corner.y) < threshold) {
        return handle
      }
    }
    return null
  }

  // Mouse handlers
  const handleMouseDown = (e) => {
    const pos = getMousePos(e)
    setDragStart(pos)
    setIsDragging(true)

    switch (currentTool) {
      case 'crop':
        const handle = getResizeHandle(pos)
        if (handle) {
          setDragMode(`resize-${handle}`)
        } else if (cropArea && pos.x > cropArea.x && pos.x < cropArea.x + cropArea.width &&
                   pos.y > cropArea.y && pos.y < cropArea.y + cropArea.height) {
          setDragMode('move')
        } else {
          // Start drawing a new crop rectangle
          setDragMode('create')
          setCropArea({ x: pos.x, y: pos.y, width: 0, height: 0 })
        }
        break

      case 'draw':
        setCurrentAnnotation({
          type: 'draw',
          points: [pos],
          color: annotationColor,
          strokeWidth
        })
        break

      case 'circle':
        setCurrentAnnotation({
          type: 'circle',
          cx: pos.x,
          cy: pos.y,
          radius: 0,
          color: annotationColor,
          strokeWidth
        })
        break

      case 'arrow':
        setCurrentAnnotation({
          type: 'arrow',
          x1: pos.x,
          y1: pos.y,
          x2: pos.x,
          y2: pos.y,
          color: annotationColor,
          strokeWidth
        })
        break

      case 'text':
        setTextInput({ show: true, x: pos.x, y: pos.y, value: '', width: 200, height: 60, editIndex: null })
        break
    }
  }

  const handleMouseMove = (e) => {
    if (!isDragging) return
    const pos = getMousePos(e)
    const canvas = overlayCanvasRef.current
    if (!canvas) return

    switch (currentTool) {
      case 'crop':
        if (dragMode === 'create') {
          // Draw rectangle from drag start to current position
          const newCrop = {
            x: Math.max(0, Math.min(dragStart.x, pos.x)),
            y: Math.max(0, Math.min(dragStart.y, pos.y)),
            width: Math.min(Math.abs(pos.x - dragStart.x), canvas.width - Math.min(dragStart.x, pos.x)),
            height: Math.min(Math.abs(pos.y - dragStart.y), canvas.height - Math.min(dragStart.y, pos.y))
          }
          setCropArea(newCrop)
        } else if (dragMode === 'move' && cropArea) {
          const dx = pos.x - dragStart.x
          const dy = pos.y - dragStart.y
          const newX = Math.max(0, Math.min(canvas.width - cropArea.width, cropArea.x + dx))
          const newY = Math.max(0, Math.min(canvas.height - cropArea.height, cropArea.y + dy))
          setCropArea(prev => ({ ...prev, x: newX, y: newY }))
          setDragStart(pos)
        } else if (dragMode?.startsWith('resize-') && cropArea) {
          const handle = dragMode.split('-')[1]
          let { x, y, width, height } = cropArea

          if (handle.includes('w')) {
            const newX = Math.max(0, Math.min(x + width - 20, pos.x))
            width = width + (x - newX)
            x = newX
          }
          if (handle.includes('e')) {
            width = Math.max(20, Math.min(canvas.width - x, pos.x - x))
          }
          if (handle.includes('n')) {
            const newY = Math.max(0, Math.min(y + height - 20, pos.y))
            height = height + (y - newY)
            y = newY
          }
          if (handle.includes('s')) {
            height = Math.max(20, Math.min(canvas.height - y, pos.y - y))
          }

          setCropArea({ x, y, width, height })
        }
        break

      case 'draw':
        if (currentAnnotation) {
          setCurrentAnnotation(prev => ({
            ...prev,
            points: [...prev.points, pos]
          }))
        }
        break

      case 'circle':
        if (currentAnnotation) {
          const radius = Math.sqrt(
            Math.pow(pos.x - currentAnnotation.cx, 2) +
            Math.pow(pos.y - currentAnnotation.cy, 2)
          )
          setCurrentAnnotation(prev => ({ ...prev, radius }))
        }
        break

      case 'arrow':
        if (currentAnnotation) {
          setCurrentAnnotation(prev => ({ ...prev, x2: pos.x, y2: pos.y }))
        }
        break
    }
  }

  const handleMouseUp = () => {
    // For crop tool, ensure minimum size
    if (currentTool === 'crop' && dragMode === 'create' && cropArea) {
      if (cropArea.width < 20 || cropArea.height < 20) {
        // Ignore tiny drag gestures and require an intentional rectangle.
        setCropArea(null)
      }
    }

    if (currentAnnotation && currentAnnotation.type !== 'text') {
      let shouldAdd = false
      switch (currentAnnotation.type) {
        case 'draw':
          shouldAdd = currentAnnotation.points.length > 2
          break
        case 'circle':
          shouldAdd = currentAnnotation.radius > 5
          break
        case 'arrow':
          const dx = currentAnnotation.x2 - currentAnnotation.x1
          const dy = currentAnnotation.y2 - currentAnnotation.y1
          shouldAdd = Math.sqrt(dx * dx + dy * dy) > 10
          break
      }
      if (shouldAdd) {
        setAnnotations(prev => [...prev, currentAnnotation])
      }
      setCurrentAnnotation(null)
    }

    setIsDragging(false)
    setDragMode(null)
  }

  const handleTextSubmit = () => {
    if (textInput.value.trim()) {
      if (textInput.editIndex !== null && textInput.editIndex !== undefined) {
        // Editing existing text
        setAnnotations(prev => prev.map((ann, i) =>
          i === textInput.editIndex
            ? { ...ann, text: textInput.value, width: textInput.width, height: textInput.height }
            : ann
        ))
      } else {
        // Creating new text
        setAnnotations(prev => [...prev, {
          type: 'text',
          x: textInput.x,
          y: textInput.y,
          text: textInput.value,
          fontSize: textFontSize,
          width: textInput.width,
          height: textInput.height,
          color: annotationColor
        }])
      }
    } else if (textInput.editIndex !== null && textInput.editIndex !== undefined) {
      // Deleted all text from existing annotation - remove it
      setAnnotations(prev => prev.filter((_, i) => i !== textInput.editIndex))
    }
    setTextInput({ show: false, x: 0, y: 0, value: '', width: 200, height: 60, editIndex: null })
    setEditingTextIndex(null)
  }

  const handleUndo = () => {
    setAnnotations(prev => prev.slice(0, -1))
  }

  const handleReset = () => {
    setAnnotations([])
    setCropArea(null)
  }

  // Delete annotation
  const deleteAnnotation = (index) => {
    setAnnotations(prev => prev.filter((_, i) => i !== index))
    setHoveredAnnotation(null)
  }

  // Start dragging an annotation
  const startDragAnnotation = (e, index, type) => {
    e.stopPropagation()
    e.preventDefault()
    const ann = annotations[index]
    setDraggingAnnotation({
      index,
      type,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      // Store original positions
      origX: ann.x,
      origY: ann.y,
      origX1: ann.x1,
      origY1: ann.y1,
      origX2: ann.x2,
      origY2: ann.y2,
      origCx: ann.cx,
      origCy: ann.cy,
      origPoints: ann.points ? [...ann.points] : null
    })
  }

  // Handle annotation drag move
  const handleAnnotationDrag = (e) => {
    if (!draggingAnnotation) return
    const { index, startMouseX, startMouseY, origX, origY, origX1, origY1, origX2, origY2, origCx, origCy, origPoints } = draggingAnnotation
    const dx = e.clientX - startMouseX
    const dy = e.clientY - startMouseY

    setAnnotations(prev => prev.map((ann, i) => {
      if (i !== index) return ann
      switch (ann.type) {
        case 'text':
          return { ...ann, x: origX + dx, y: origY + dy }
        case 'arrow':
          return { ...ann, x1: origX1 + dx, y1: origY1 + dy, x2: origX2 + dx, y2: origY2 + dy }
        case 'circle':
          return { ...ann, cx: origCx + dx, cy: origCy + dy }
        case 'draw':
          return { ...ann, points: origPoints.map(p => ({ x: p.x + dx, y: p.y + dy })) }
        default:
          return ann
      }
    }))
  }

  // End annotation drag
  const endAnnotationDrag = () => {
    setDraggingAnnotation(null)
  }

  // Start resizing text box (corner resize for width/height)
  const startResizeText = (e, index, corner) => {
    e.stopPropagation()
    e.preventDefault()
    const ann = annotations[index]
    setResizingText({
      index,
      corner, // 'se', 'sw', 'ne', 'nw'
      startX: e.clientX,
      startY: e.clientY,
      origWidth: ann.width || 200,
      origHeight: ann.height || 60,
      origX: ann.x,
      origY: ann.y
    })
  }

  // Handle text box resize
  const handleTextResize = (e) => {
    if (!resizingText) return
    const { index, corner, startX, startY, origWidth, origHeight, origX, origY } = resizingText
    const dx = e.clientX - startX
    const dy = e.clientY - startY

    let newWidth = origWidth
    let newHeight = origHeight
    let newX = origX
    let newY = origY

    // Adjust based on which corner is being dragged
    if (corner === 'se') {
      newWidth = Math.max(80, origWidth + dx)
      newHeight = Math.max(30, origHeight + dy)
    } else if (corner === 'sw') {
      newWidth = Math.max(80, origWidth - dx)
      newHeight = Math.max(30, origHeight + dy)
      newX = origX + (origWidth - newWidth)
    } else if (corner === 'ne') {
      newWidth = Math.max(80, origWidth + dx)
      newHeight = Math.max(30, origHeight - dy)
      newY = origY + (origHeight - newHeight)
    } else if (corner === 'nw') {
      newWidth = Math.max(80, origWidth - dx)
      newHeight = Math.max(30, origHeight - dy)
      newX = origX + (origWidth - newWidth)
      newY = origY + (origHeight - newHeight)
    }

    setAnnotations(prev => prev.map((ann, i) =>
      i === index ? { ...ann, width: newWidth, height: newHeight, x: newX, y: newY } : ann
    ))
  }

  // End text resize
  const endTextResize = () => {
    setResizingText(null)
  }

  // Start editing existing text
  const startEditText = (index) => {
    const ann = annotations[index]
    setTextInput({
      show: true,
      x: ann.x,
      y: ann.y,
      value: ann.text,
      width: ann.width || 200,
      height: ann.height || 60,
      editIndex: index
    })
    setEditingTextIndex(index)
  }

  // Start resizing circle
  const startResizeCircle = (e, index) => {
    e.stopPropagation()
    e.preventDefault()
    const ann = annotations[index]
    setResizingCircle({
      index,
      startX: e.clientX,
      startY: e.clientY,
      startRadius: ann.radius || 20,
      cx: ann.cx,
      cy: ann.cy
    })
  }

  // Handle circle resize
  const handleCircleResize = (e) => {
    if (!resizingCircle) return
    const { index, cx, cy, startRadius } = resizingCircle
    // Calculate new radius based on distance from center
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const newRadius = Math.max(10, Math.sqrt(Math.pow(mouseX - cx, 2) + Math.pow(mouseY - cy, 2)))
    setAnnotations(prev => prev.map((ann, i) =>
      i === index ? { ...ann, radius: newRadius } : ann
    ))
  }

  // End circle resize
  const endCircleResize = () => {
    setResizingCircle(null)
  }

  // Start resizing arrow (move endpoint)
  const startResizeArrow = (e, index, endpoint) => {
    e.stopPropagation()
    e.preventDefault()
    setResizingArrow({
      index,
      endpoint,
      startX: e.clientX,
      startY: e.clientY
    })
  }

  // Handle arrow resize (move endpoint)
  const handleArrowResize = (e) => {
    if (!resizingArrow) return
    const { index, endpoint } = resizingArrow
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    setAnnotations(prev => prev.map((ann, i) => {
      if (i !== index) return ann
      if (endpoint === 'start') {
        return { ...ann, x1: mouseX, y1: mouseY }
      } else {
        return { ...ann, x2: mouseX, y2: mouseY }
      }
    }))
  }

  // End arrow resize
  const endArrowResize = () => {
    setResizingArrow(null)
  }

  // Get bounding box for draw annotation
  const getDrawBounds = (points) => {
    if (!points || points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)
    return {
      minX: Math.min(...xs) - 10,
      minY: Math.min(...ys) - 10,
      maxX: Math.max(...xs) + 10,
      maxY: Math.max(...ys) + 10
    }
  }

  // Confirm and generate final image at FULL resolution
  const handleConfirm = () => {
    if (!originalImage || !cropArea) return

    // Calculate crop area in original image coordinates
    const origCropX = cropArea.x / displayScale
    const origCropY = cropArea.y / displayScale
    const origCropW = cropArea.width / displayScale
    const origCropH = cropArea.height / displayScale

    // Store original crop area in image coordinates (for re-editing)
    const originalCropArea = {
      x: origCropX,
      y: origCropY,
      width: origCropW,
      height: origCropH
    }

    // Store annotations in original image coordinates (for re-editing)
    const originalAnnotations = annotations.map(ann => {
      const origAnn = { ...ann }
      switch (ann.type) {
        case 'draw':
          origAnn.points = ann.points.map(p => ({
            x: p.x / displayScale,
            y: p.y / displayScale
          }))
          origAnn.strokeWidth = (ann.strokeWidth || 4) / displayScale
          break
        case 'circle':
          origAnn.cx = ann.cx / displayScale
          origAnn.cy = ann.cy / displayScale
          origAnn.radius = ann.radius / displayScale
          origAnn.strokeWidth = (ann.strokeWidth || 4) / displayScale
          break
        case 'arrow':
          origAnn.x1 = ann.x1 / displayScale
          origAnn.y1 = ann.y1 / displayScale
          origAnn.x2 = ann.x2 / displayScale
          origAnn.y2 = ann.y2 / displayScale
          origAnn.strokeWidth = (ann.strokeWidth || 4) / displayScale
          break
        case 'text':
          origAnn.x = ann.x / displayScale
          origAnn.y = ann.y / displayScale
          origAnn.fontSize = ann.fontSize / displayScale
          origAnn.width = (ann.width || 200) / displayScale
          origAnn.height = (ann.height || 60) / displayScale
          break
      }
      return origAnn
    })

    // Create output canvas at original resolution
    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = origCropW
    outputCanvas.height = origCropH
    const ctx = outputCanvas.getContext('2d')

    // Draw cropped portion of original image
    ctx.drawImage(
      originalImage,
      origCropX, origCropY, origCropW, origCropH,
      0, 0, origCropW, origCropH
    )

    // Draw annotations scaled to original image size
    const scaleX = origCropW / cropArea.width
    const scaleY = origCropH / cropArea.height

    annotations.forEach(ann => {
      const scaledAnn = { ...ann, strokeWidth: (ann.strokeWidth || 4) * scaleX }

      switch (ann.type) {
        case 'draw':
          scaledAnn.points = ann.points.map(p => ({
            x: (p.x - cropArea.x) * scaleX,
            y: (p.y - cropArea.y) * scaleY
          }))
          break
        case 'circle':
          scaledAnn.cx = (ann.cx - cropArea.x) * scaleX
          scaledAnn.cy = (ann.cy - cropArea.y) * scaleY
          scaledAnn.radius = ann.radius * Math.min(scaleX, scaleY)
          break
        case 'arrow':
          scaledAnn.x1 = (ann.x1 - cropArea.x) * scaleX
          scaledAnn.y1 = (ann.y1 - cropArea.y) * scaleY
          scaledAnn.x2 = (ann.x2 - cropArea.x) * scaleX
          scaledAnn.y2 = (ann.y2 - cropArea.y) * scaleY
          break
        case 'text':
          scaledAnn.x = (ann.x - cropArea.x) * scaleX
          scaledAnn.y = (ann.y - cropArea.y) * scaleY
          scaledAnn.fontSize = ann.fontSize * Math.min(scaleX, scaleY)
          scaledAnn.width = (ann.width || 200) * scaleX
          scaledAnn.height = (ann.height || 60) * scaleY
          break
      }

      drawAnnotation(ctx, scaledAnn)
    })

    // Use PNG for better quality, or JPEG with high quality
    const finalDataUrl = outputCanvas.toDataURL('image/png')

    onConfirm({
      dataUrl: finalDataUrl,
      pageNum: imageData.pageNum,
      isUploaded: imageData.isUploaded,
      width: outputCanvas.width,
      height: outputCanvas.height,
      cropped: cropArea.width < canvasRef.current?.width || cropArea.height < canvasRef.current?.height,
      annotated: annotations.length > 0,
      // Store original data for re-editing
      originalDataUrl: imageData.dataUrl,
      originalWidth: originalImage.width,
      originalHeight: originalImage.height,
      cropArea: originalCropArea,
      annotations: originalAnnotations
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-2">
      <div className="bg-white rounded-xl shadow-2xl max-w-[95vw] w-full max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Crop & Annotate Slide</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-2 border-b border-gray-200 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {[
              { id: 'crop', icon: Crop, label: 'Crop' },
              { id: 'draw', icon: Pencil, label: 'Draw' },
              { id: 'circle', icon: Circle, label: 'Circle' },
              { id: 'arrow', icon: ArrowRight, label: 'Arrow' },
              { id: 'text', icon: Type, label: 'Text' }
            ].map(tool => (
              <button
                key={tool.id}
                onClick={() => setCurrentTool(tool.id)}
                className={`px-3 py-1.5 rounded-md transition-colors text-sm font-medium flex items-center gap-1.5 ${
                  currentTool === tool.id
                    ? 'bg-white shadow text-indigo-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <tool.icon className="w-4 h-4" />
                {tool.label}
              </button>
            ))}
          </div>

          {currentTool !== 'crop' && (
            <div className="flex items-center gap-1">
              {COLORS.map(color => (
                <button
                  key={color}
                  onClick={() => setAnnotationColor(color)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${
                    annotationColor === color ? 'border-gray-800 scale-110' : 'border-gray-300'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          )}

          {['draw', 'circle', 'arrow'].includes(currentTool) && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Width:</span>
              <input
                type="range"
                min="2"
                max="12"
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
                className="w-24"
              />
              <span className="text-xs text-gray-600 w-4">{strokeWidth}</span>
            </div>
          )}

          {currentTool === 'text' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Size:</span>
              <input
                type="range"
                min="14"
                max="60"
                value={textFontSize}
                onChange={(e) => setTextFontSize(parseInt(e.target.value))}
                className="w-24"
              />
              <span className="text-xs text-gray-600 w-6">{textFontSize}</span>
            </div>
          )}

          <div className="flex-1" />

          <button
            onClick={handleUndo}
            disabled={annotations.length === 0}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            Undo
          </button>
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>

        {/* Canvas area */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto p-4 bg-gray-800 flex items-center justify-center min-h-0 relative"
        >
          {/* Loading overlay - shown on top of canvas while loading */}
          {!imageLoaded && (
            <div className="absolute inset-0 bg-gray-800 flex items-center justify-center z-10">
              <div className="flex items-center gap-2 text-white">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Loading high-resolution slide...</span>
              </div>
            </div>
          )}

          {/* Canvas - always rendered so refs are available */}
          <div className="relative inline-block">
            <canvas
              ref={canvasRef}
              className="rounded shadow-lg"
            />
            <canvas
              ref={overlayCanvasRef}
              className="absolute top-0 left-0"
              style={{ cursor: 'crosshair' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
            {textInput.show && (
              <div
                className="absolute z-50"
                style={{
                  left: textInput.x,
                  top: textInput.y,
                  width: textInput.width,
                  height: textInput.height
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <textarea
                  ref={(input) => input && setTimeout(() => input.focus(), 10)}
                  value={textInput.value}
                  onChange={(e) => setTextInput(prev => ({ ...prev, value: e.target.value }))}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      textSubmittedRef.current = true
                      handleTextSubmit()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      textSubmittedRef.current = true
                      setTextInput({ show: false, x: 0, y: 0, value: '', width: 200, height: 60, editIndex: null })
                      setEditingTextIndex(null)
                    }
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      if (textSubmittedRef.current) {
                        textSubmittedRef.current = false
                        return
                      }
                      // Submit on blur instead of discarding
                      handleTextSubmit()
                    }, 50)
                  }}
                  className="w-full h-full border-2 border-indigo-500 rounded px-2 py-1 outline-none bg-white/95 resize-none"
                  style={{
                    color: textInput.editIndex !== null ? annotations[textInput.editIndex]?.color : annotationColor,
                    fontSize: textInput.editIndex !== null ? annotations[textInput.editIndex]?.fontSize : textFontSize,
                    fontWeight: 'bold',
                    textShadow: '1px 1px 2px rgba(0,0,0,0.3)'
                  }}
                  placeholder="Type text... (Shift+Enter for new line)"
                />
                {/* Resize handles for text input */}
                <div
                  className="absolute w-3 h-3 bg-indigo-500 rounded-sm cursor-se-resize"
                  style={{ bottom: -6, right: -6 }}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    const startX = e.clientX
                    const startY = e.clientY
                    const startWidth = textInput.width
                    const startHeight = textInput.height
                    const handleMove = (moveE) => {
                      const dx = moveE.clientX - startX
                      const dy = moveE.clientY - startY
                      setTextInput(prev => ({
                        ...prev,
                        width: Math.max(80, startWidth + dx),
                        height: Math.max(30, startHeight + dy)
                      }))
                    }
                    const handleUp = () => {
                      document.removeEventListener('mousemove', handleMove)
                      document.removeEventListener('mouseup', handleUp)
                    }
                    document.addEventListener('mousemove', handleMove)
                    document.addEventListener('mouseup', handleUp)
                  }}
                />
              </div>
            )}

            {/* Text annotation overlays - show when text tool is selected */}
            {currentTool === 'text' && !textInput.show && annotations.map((ann, idx) => {
              if (ann.type !== 'text') return null
              if (editingTextIndex === idx) return null // Skip if being edited
              const isHovered = hoveredAnnotation?.index === idx && hoveredAnnotation?.type === 'text'
              const isDragged = draggingAnnotation?.index === idx
              const isResizing = resizingText?.index === idx
              const isActive = isHovered || isDragged || isResizing
              const fontSize = ann.fontSize || 20
              const boxWidth = ann.width || 200
              const boxHeight = ann.height || 60
              return (
                <div
                  key={`text-overlay-${idx}`}
                  className="absolute select-none"
                  style={{
                    left: ann.x - 12,
                    top: ann.y - 12,
                    width: boxWidth + 24,
                    height: boxHeight + 24,
                    zIndex: 40,
                    pointerEvents: 'auto'
                  }}
                  onMouseEnter={() => setHoveredAnnotation({ index: idx, type: 'text' })}
                  onMouseLeave={() => { if (!isResizing && !isDragged) setHoveredAnnotation(null) }}
                >
                  {/* Text box background and border */}
                  <div
                    className="absolute rounded cursor-move"
                    style={{
                      left: 12,
                      top: 12,
                      width: boxWidth,
                      height: boxHeight,
                      background: isActive ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                      border: isActive ? '2px dashed #6366f1' : '1px dashed transparent'
                    }}
                    onMouseDown={(e) => {
                      // Don't start drag on double-click (detail === 2)
                      if (e.detail === 2) {
                        e.stopPropagation()
                        e.preventDefault()
                        startEditText(idx)
                      } else {
                        startDragAnnotation(e, idx, 'text')
                      }
                    }}
                  >
                    {/* Text content with wrapping */}
                    <div
                      style={{
                        padding: '4px 6px',
                        color: ann.color,
                        fontSize: `${fontSize}px`,
                        fontWeight: 'bold',
                        textShadow: '1px 1px 1px rgba(255,255,255,0.8)',
                        wordWrap: 'break-word',
                        overflow: 'hidden',
                        height: '100%',
                        pointerEvents: 'none'
                      }}
                    >
                      {ann.text}
                    </div>
                  </div>

                  {/* Delete button - positioned top center to avoid overlap with resize handles */}
                  {isActive && !isDragged && (
                    <button
                      className="absolute w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-md"
                      style={{ zIndex: 46, top: 0, left: '50%', transform: 'translateX(-50%)' }}
                      onClick={(e) => { e.stopPropagation(); deleteAnnotation(idx) }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  )}

                  {/* Corner resize handles */}
                  {isActive && !isDragged && (
                    <>
                      {/* SE corner */}
                      <div
                        className="absolute w-3 h-3 bg-indigo-500 hover:bg-indigo-400 rounded-sm cursor-se-resize shadow-md"
                        style={{ zIndex: 45, bottom: 6, right: 6 }}
                        onMouseDown={(e) => startResizeText(e, idx, 'se')}
                      />
                      {/* SW corner */}
                      <div
                        className="absolute w-3 h-3 bg-indigo-500 hover:bg-indigo-400 rounded-sm cursor-sw-resize shadow-md"
                        style={{ zIndex: 45, bottom: 6, left: 6 }}
                        onMouseDown={(e) => startResizeText(e, idx, 'sw')}
                      />
                      {/* NE corner */}
                      <div
                        className="absolute w-3 h-3 bg-indigo-500 hover:bg-indigo-400 rounded-sm cursor-ne-resize shadow-md"
                        style={{ zIndex: 45, top: 6, right: 6 }}
                        onMouseDown={(e) => startResizeText(e, idx, 'ne')}
                      />
                      {/* NW corner */}
                      <div
                        className="absolute w-3 h-3 bg-indigo-500 hover:bg-indigo-400 rounded-sm cursor-nw-resize shadow-md"
                        style={{ zIndex: 45, top: 6, left: 6 }}
                        onMouseDown={(e) => startResizeText(e, idx, 'nw')}
                      />
                    </>
                  )}

                  {/* Edit hint */}
                  {isHovered && !isDragged && !isResizing && (
                    <div
                      className="absolute text-xs text-indigo-600 bg-white/90 px-1 rounded shadow-sm"
                      style={{ bottom: -6, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', pointerEvents: 'none' }}
                    >
                      Double-click to edit
                    </div>
                  )}
                </div>
              )
            })}

            {/* Arrow annotation overlays - show when arrow tool is selected */}
            {currentTool === 'arrow' && annotations.map((ann, idx) => {
              if (ann.type !== 'arrow') return null
              const isHovered = hoveredAnnotation?.index === idx && hoveredAnnotation?.type === 'arrow'
              const isDragged = draggingAnnotation?.index === idx
              const isResizing = resizingArrow?.index === idx
              const isActive = isHovered || isDragged || isResizing
              const minX = Math.min(ann.x1, ann.x2) - 20
              const minY = Math.min(ann.y1, ann.y2) - 20
              const maxX = Math.max(ann.x1, ann.x2) + 20
              const maxY = Math.max(ann.y1, ann.y2) + 20
              const width = maxX - minX
              const height = maxY - minY
              // Arrow head calculation
              const angle = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1)
              const headLen = 18
              return (
                <div
                  key={`arrow-overlay-${idx}`}
                  className="absolute"
                  style={{
                    left: minX,
                    top: minY,
                    width: width,
                    height: height,
                    zIndex: 40,
                    pointerEvents: 'auto'
                  }}
                  onMouseEnter={() => setHoveredAnnotation({ index: idx, type: 'arrow' })}
                  onMouseLeave={() => { if (!isResizing && !isDragged) setHoveredAnnotation(null) }}
                >
                  {/* SVG to draw the arrow */}
                  <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                    {/* Arrow line */}
                    <line
                      x1={ann.x1 - minX}
                      y1={ann.y1 - minY}
                      x2={ann.x2 - minX}
                      y2={ann.y2 - minY}
                      stroke={ann.color}
                      strokeWidth={ann.strokeWidth || 4}
                      strokeLinecap="round"
                    />
                    {/* Arrow head */}
                    <line
                      x1={ann.x2 - minX}
                      y1={ann.y2 - minY}
                      x2={ann.x2 - minX - headLen * Math.cos(angle - Math.PI / 6)}
                      y2={ann.y2 - minY - headLen * Math.sin(angle - Math.PI / 6)}
                      stroke={ann.color}
                      strokeWidth={ann.strokeWidth || 4}
                      strokeLinecap="round"
                    />
                    <line
                      x1={ann.x2 - minX}
                      y1={ann.y2 - minY}
                      x2={ann.x2 - minX - headLen * Math.cos(angle + Math.PI / 6)}
                      y2={ann.y2 - minY - headLen * Math.sin(angle + Math.PI / 6)}
                      stroke={ann.color}
                      strokeWidth={ann.strokeWidth || 4}
                      strokeLinecap="round"
                    />
                    {/* Highlight when active */}
                    {isActive && (
                      <rect
                        x={0}
                        y={0}
                        width={width}
                        height={height}
                        fill="rgba(99, 102, 241, 0.1)"
                        stroke="#6366f1"
                        strokeWidth={1}
                        strokeDasharray="4 2"
                        rx={4}
                      />
                    )}
                  </svg>
                  {/* Drag area (the full bounding box) */}
                  <div
                    className="absolute inset-0 cursor-move"
                    onMouseDown={(e) => startDragAnnotation(e, idx, 'arrow')}
                  />
                  {/* Delete button */}
                  {isActive && !isDragged && (
                    <button
                      className="absolute w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-md"
                      style={{ zIndex: 46, top: -10, left: '50%', transform: 'translateX(-50%)' }}
                      onClick={(e) => { e.stopPropagation(); deleteAnnotation(idx) }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  )}
                  {/* Start point handle */}
                  {isActive && !isDragged && (
                    <div
                      className="absolute w-4 h-4 bg-green-500 hover:bg-green-400 rounded-full cursor-crosshair flex items-center justify-center shadow-md"
                      style={{
                        zIndex: 45,
                        left: ann.x1 - minX - 8,
                        top: ann.y1 - minY - 8
                      }}
                      onMouseDown={(e) => startResizeArrow(e, idx, 'start')}
                    />
                  )}
                  {/* End point handle */}
                  {isActive && !isDragged && (
                    <div
                      className="absolute w-4 h-4 bg-indigo-500 hover:bg-indigo-400 rounded-full cursor-crosshair flex items-center justify-center shadow-md"
                      style={{
                        zIndex: 45,
                        left: ann.x2 - minX - 8,
                        top: ann.y2 - minY - 8
                      }}
                      onMouseDown={(e) => startResizeArrow(e, idx, 'end')}
                    />
                  )}
                </div>
              )
            })}

            {/* Circle annotation overlays - show when circle tool is selected */}
            {currentTool === 'circle' && annotations.map((ann, idx) => {
              if (ann.type !== 'circle') return null
              const isHovered = hoveredAnnotation?.index === idx && hoveredAnnotation?.type === 'circle'
              const isDragged = draggingAnnotation?.index === idx
              const isResizing = resizingCircle?.index === idx
              const isActive = isHovered || isDragged || isResizing
              const r = ann.radius || 0
              return (
                <div
                  key={`circle-overlay-${idx}`}
                  className="absolute"
                  style={{
                    left: ann.cx - r - 15,
                    top: ann.cy - r - 15,
                    width: r * 2 + 30,
                    height: r * 2 + 30,
                    zIndex: 40,
                    pointerEvents: 'auto'
                  }}
                  onMouseEnter={() => setHoveredAnnotation({ index: idx, type: 'circle' })}
                  onMouseLeave={() => { if (!isResizing && !isDragged) setHoveredAnnotation(null) }}
                >
                  {/* SVG to draw the circle */}
                  <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                    <circle
                      cx={r + 15}
                      cy={r + 15}
                      r={r}
                      fill="none"
                      stroke={ann.color}
                      strokeWidth={ann.strokeWidth || 4}
                    />
                    {isActive && (
                      <circle
                        cx={r + 15}
                        cy={r + 15}
                        r={r}
                        fill="rgba(99, 102, 241, 0.1)"
                        stroke="#6366f1"
                        strokeWidth={1}
                        strokeDasharray="4 2"
                      />
                    )}
                  </svg>
                  {/* Drag area (center) */}
                  <div
                    className="absolute cursor-move"
                    style={{
                      left: 15,
                      top: 15,
                      width: r * 2,
                      height: r * 2,
                      borderRadius: '50%'
                    }}
                    onMouseDown={(e) => startDragAnnotation(e, idx, 'circle')}
                  />
                  {/* Delete button */}
                  {isActive && !isDragged && (
                    <button
                      className="absolute w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-md"
                      style={{ zIndex: 46, top: 0, left: '50%', transform: 'translateX(-50%)' }}
                      onClick={(e) => { e.stopPropagation(); deleteAnnotation(idx) }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  )}
                  {/* Resize handle (on the right edge) */}
                  {isActive && !isDragged && (
                    <div
                      className="absolute w-4 h-4 bg-indigo-500 hover:bg-indigo-400 rounded-full cursor-ew-resize flex items-center justify-center shadow-md"
                      style={{
                        zIndex: 45,
                        left: r * 2 + 15 - 8,
                        top: r + 15 - 8
                      }}
                      onMouseDown={(e) => startResizeCircle(e, idx)}
                    >
                      <Move className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </div>
              )
            })}

            {/* Draw annotation overlays - show when draw tool is selected */}
            {currentTool === 'draw' && annotations.map((ann, idx) => {
              if (ann.type !== 'draw') return null
              const isHovered = hoveredAnnotation?.index === idx && hoveredAnnotation?.type === 'draw'
              const isDragged = draggingAnnotation?.index === idx
              const isActive = isHovered || isDragged
              const bounds = getDrawBounds(ann.points)
              const width = bounds.maxX - bounds.minX
              const height = bounds.maxY - bounds.minY
              // Create SVG path from points
              const pathD = ann.points.length > 1
                ? `M ${ann.points[0].x - bounds.minX} ${ann.points[0].y - bounds.minY} ` +
                  ann.points.slice(1).map(p => `L ${p.x - bounds.minX} ${p.y - bounds.minY}`).join(' ')
                : ''
              return (
                <div
                  key={`draw-overlay-${idx}`}
                  className="absolute"
                  style={{
                    left: bounds.minX,
                    top: bounds.minY,
                    width: width,
                    height: height,
                    zIndex: 40,
                    pointerEvents: 'auto'
                  }}
                  onMouseEnter={() => setHoveredAnnotation({ index: idx, type: 'draw' })}
                  onMouseLeave={() => { if (!isDragged) setHoveredAnnotation(null) }}
                >
                  {/* SVG to draw the path */}
                  <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={ann.color}
                      strokeWidth={ann.strokeWidth || 4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {isActive && (
                      <rect
                        x={0}
                        y={0}
                        width={width}
                        height={height}
                        fill="rgba(99, 102, 241, 0.1)"
                        stroke="#6366f1"
                        strokeWidth={1}
                        strokeDasharray="4 2"
                        rx={4}
                      />
                    )}
                  </svg>
                  {/* Drag area */}
                  <div
                    className="absolute inset-0 cursor-move"
                    onMouseDown={(e) => startDragAnnotation(e, idx, 'draw')}
                  />
                  {/* Delete button */}
                  {isActive && !isDragged && (
                    <button
                      className="absolute w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-md"
                      style={{ zIndex: 46, top: -10, left: '50%', transform: 'translateX(-50%)' }}
                      onClick={(e) => { e.stopPropagation(); deleteAnnotation(idx) }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  )}
                </div>
              )
            })}

            {/* Global mouse handlers for dragging annotations */}
            {draggingAnnotation && (
              <div
                className="fixed inset-0 z-50"
                style={{ cursor: 'move' }}
                onMouseMove={handleAnnotationDrag}
                onMouseUp={endAnnotationDrag}
                onMouseLeave={endAnnotationDrag}
              />
            )}

            {/* Global mouse handlers for text resizing */}
            {resizingText && (
              <div
                className="fixed inset-0 z-50"
                style={{ cursor: 'ns-resize' }}
                onMouseMove={handleTextResize}
                onMouseUp={endTextResize}
                onMouseLeave={endTextResize}
              />
            )}

            {/* Global mouse handlers for circle resizing */}
            {resizingCircle && (
              <div
                className="fixed inset-0 z-50"
                style={{ cursor: 'ew-resize' }}
                onMouseMove={handleCircleResize}
                onMouseUp={endCircleResize}
                onMouseLeave={endCircleResize}
              />
            )}

            {/* Global mouse handlers for arrow resizing */}
            {resizingArrow && (
              <div
                className="fixed inset-0 z-50"
                style={{ cursor: 'crosshair' }}
                onMouseMove={handleArrowResize}
                onMouseUp={endArrowResize}
                onMouseLeave={endArrowResize}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 flex justify-between items-center">
          <p className="text-sm text-gray-500">
            {currentTool === 'crop' && (cropArea ? 'Drag inside crop to move, corners to resize, or draw a new rectangle' : 'Click and drag to draw crop rectangle')}
            {currentTool === 'draw' && 'Click and drag to draw freehand'}
            {currentTool === 'circle' && 'Click center, drag to set radius'}
            {currentTool === 'arrow' && 'Click start, drag to end point'}
            {currentTool === 'text' && 'Click to add text box, double-click existing to edit, drag corners to resize'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!imageLoaded || !cropArea}
              className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 rounded-lg flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              Insert Image
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
