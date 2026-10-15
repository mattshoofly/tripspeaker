import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4417, strictPort: true },
  preview: { host: '127.0.0.1', port: 4418, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks cache across deploys; app code changes most.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'gsap', test: /node_modules[\\/](gsap|@gsap)[\\/]/ },
            { name: 'peer', test: /node_modules[\\/](peerjs|peerjs-js-binarypack|webrtc-adapter|sdp|eventemitter3)[\\/]/ },
          ],
        },
      },
    },
  },
});
