import { defineConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// `--mode mock` runs the app on the in-memory fake API of mock/. Only that mode loads it.
export default defineConfig(async ({ mode }) => ({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    mode === 'mock' && (await import('./mock/plugin.ts')).mockApi(),
  ],
  server: {
    proxy: mode === 'mock' ? undefined : {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    chunkSizeWarningLimit: 1800,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'mock/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: './src/test/setup.ts',
    // Vitest empties stylesheets; `lib/theme.ts` reads its tokens from this one's source.
    css: { include: [/index\.css\?raw$/] },
    pool: 'vmThreads',
  },
}))
