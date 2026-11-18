import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// VITE_BASE lets the build live under a sub-path, e.g. GitHub Pages /matthew/panko/.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
});
