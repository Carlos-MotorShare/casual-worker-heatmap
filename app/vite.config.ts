import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Allow using REACT_APP_* env vars (e.g. REACT_APP_API_URL) in Vite.
  envPrefix: ['VITE_', 'REACT_APP_'],
  server: {
    allowedHosts: [
      'localhost',
      'bernice-unsuspended-unenforcedly.ngrok-free.dev'
    ]
  }
})
