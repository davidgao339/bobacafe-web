import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/demo/inventory-app/',
  server: {
    proxy: {
      '/databricks-proxy': {
        target: 'https://dbc-d5bd17fc-eaf4.cloud.databricks.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/databricks-proxy/, ''),
      },
    },
  },
})
