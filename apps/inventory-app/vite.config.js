import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'development' ? '/demo/inventory-app/' : '/internal/inventory/',
  server: {
    proxy: {
      '/databricks-proxy': {
        target: 'https://dbc-d5bd17fc-eaf4.cloud.databricks.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/databricks-proxy/, ''),
      },
    },
  },
}))
