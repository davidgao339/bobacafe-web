import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: { alias: { '@inventory': path.resolve(__dirname, '../inventory-app/src') } },
  base: mode === 'development' ? '/' : '/internal/warehouse/',
  server: {
    port: 5174,
    strictPort: true,
  },
}))
