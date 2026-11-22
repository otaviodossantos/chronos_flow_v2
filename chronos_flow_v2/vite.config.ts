import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      '@shared': path.resolve(process.cwd(), 'shared'),
    },
  },
  server: {
    // Em desenvolvimento a tela tambem precisa atender pela rede; o proxy leva
    // o /api para o servidor local, que aplica o porteiro de acesso.
    host: true,
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3101' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
