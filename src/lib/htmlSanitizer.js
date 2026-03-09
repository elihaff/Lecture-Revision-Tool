/**
 * HTML Sanitizer for Flashcard Content
 * Allows safe formatting tags while removing potentially dangerous content
 */

/**
 * Sanitize HTML content for safe display
 * Allows: <strong>, <em>, <b>, <i>, <u>, <br>, <p>, <span>, <img>
 * Removes: <script>, <iframe>, onclick, onerror, etc.
 *
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML
 */
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return ''

  // Create a temporary div to parse HTML
  const temp = document.createElement('div')
  temp.innerHTML = html

  // Remove dangerous elements
  const dangerousTags = ['script', 'iframe', 'object', 'embed', 'link', 'style']
  dangerousTags.forEach(tag => {
    const elements = temp.querySelectorAll(tag)
    elements.forEach(el => el.remove())
  })

  // Remove event handlers
  const allElements = temp.querySelectorAll('*')
  allElements.forEach(el => {
    // Remove all event handler attributes
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('on')) {
        el.removeAttribute(attr.name)
      }
    })

    // Remove javascript: URLs
    if (el.href && el.href.toLowerCase().startsWith('javascript:')) {
      el.removeAttribute('href')
    }
    if (el.src && el.src.toLowerCase().startsWith('javascript:')) {
      el.removeAttribute('src')
    }
  })

  return temp.innerHTML
}

/**
 * Strip all HTML tags from content
 * Useful for previews, search, etc.
 *
 * @param {string} html - HTML string
 * @returns {string} Plain text
 */
export function stripHtml(html) {
  if (!html || typeof html !== 'string') return ''

  const temp = document.createElement('div')
  temp.innerHTML = html
  return temp.textContent || temp.innerText || ''
}

/**
 * Truncate HTML content to a certain length
 * Preserves HTML tags while limiting text length
 *
 * @param {string} html - HTML string
 * @param {number} maxLength - Maximum text length
 * @returns {string} Truncated HTML
 */
export function truncateHtml(html, maxLength = 100) {
  const text = stripHtml(html)
  if (text.length <= maxLength) return html

  // If text is longer, strip HTML and truncate
  return text.substring(0, maxLength) + '...'
}

/**
 * Check if content contains HTML tags
 *
 * @param {string} text - Text to check
 * @returns {boolean} True if contains HTML
 */
export function hasHtml(text) {
  if (!text || typeof text !== 'string') return false
  return /<[^>]+>/.test(text)
}
