import { defineConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { mockApi } from './mock/plugin'

// `--mode mock` (bun run dev:mock) runs the app on the in-memory fake API of
// mock/ instead of the Rust server: the review mode of #61.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    mode === 'mock' && mockApi(),
  ],
  server: {
    proxy: mode === 'mock' ? undefined : {
      '/api': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'mock/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: './src/test/setup.ts',
    pool: 'vmThreads',
  },
}))
