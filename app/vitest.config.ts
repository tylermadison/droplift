import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'host', include: ['backend/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'page',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./src/test-setup.ts'],
        },
      },
    ],
  },
})
