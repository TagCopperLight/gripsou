import { defineConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// `--mode mock` (bun run dev:mock) runs the app on the in-memory fake API of
// mock/ instead of the Rust server, to review the UI. Only that mode loads it;
// `tsc -b` still type-checks mock/ and vitest runs its tests.
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
    // The app ships as one chunk (about 1.6 MB, 515 kB gzip), so changing page
    // never waits on a download. ECharts is most of it, already trimmed to the
    // parts `lib/echarts.ts` registers. The limit warns if it grows much more.
    chunkSizeWarningLimit: 1800,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'mock/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: './src/test/setup.ts',
    // Vitest empties every stylesheet; `lib/theme.ts` reads its tokens from
    // this one's source.
    css: { include: [/index\.css\?raw$/] },
    pool: 'vmThreads',
  },
}))
