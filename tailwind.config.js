/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#F7F7F8',
        surface: '#FFFFFF',
        reading: '#FAFAF8',
        primary: '#111111',
        secondary: '#6B6B6B',
        accent: '#007AFF',
        divider: '#E5E5EA',
        success: '#34C759',
        error: '#FF453A',
      }
    },
  },
  plugins: [],
}
