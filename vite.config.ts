import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4417, strictPort: true },
  preview: { host: '127.0.0.1', port: 4418, strictPort: true },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
});
