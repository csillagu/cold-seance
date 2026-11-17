import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  build: {
    // The licenses of the dependencies bundled into the build (the Inter font's SIL OFL among
    // them), served next to the frontend and shipped in the Docker image with it.
    license: { fileName: 'third-party-licenses.md' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
      reporter: ['text', 'html', 'json-summary'],
    },
  },
})
