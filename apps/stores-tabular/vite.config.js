import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@inventory': path.resolve(__dirname, '../../packages/inventory-shared'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  base: mode === 'development' ? '/' : '/internal/stores-tabular/',
  server: {
    port: 5177,
    strictPort: true,
  },
}))
