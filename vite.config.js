import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the same build works on GitHub Pages under /roarme/ and inside the desktop app
export default defineConfig({ plugins: [react()], base: './' })
