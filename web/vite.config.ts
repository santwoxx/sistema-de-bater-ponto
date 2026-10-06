import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // O cálculo do espelho é compartilhado com o backend (../functions/src/espelho.ts).
  server: { port: 5173, fs: { allow: ['..'] } },
  build: { chunkSizeWarningLimit: 1500 },
})
