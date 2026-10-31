import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backendPort = process.env.BACKEND_PORT || process.env.PORT || '4000'
const backendTarget = `http://127.0.0.1:${backendPort}`

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backendTarget,
    },
  },
})
