import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Two pages: the dashboard (index.html) and the progress window (progress.html).
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: 'index.html', progress: 'progress.html' } } },
})
