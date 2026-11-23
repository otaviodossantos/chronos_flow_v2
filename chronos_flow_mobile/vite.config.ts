import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * O desktop continua sendo a fonte da verdade do que e logica pura: dominio,
 * tipos e schemas entram por alias, nunca por copia. Copia diverge, e divergir
 * na cascata de pesos seria ter dois apps que discordam do mesmo numero.
 *
 * A interface NAO e compartilhada de proposito: ela precisa divergir para
 * caber no dedo, e congela-la atraves de alias seria amarrar os dois.
 */
const desktop = path.resolve(process.cwd(), '..', 'chronos_flow_v2');

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      '@db': path.resolve(process.cwd(), 'db'),
      '@core': path.join(desktop, 'server', 'domain'),
      '@shared': path.join(desktop, 'shared'),
      '@ia': path.join(desktop, 'server', 'modules', 'ai'),
      // O cliente HTTP do desktop: no modo servidor o iPhone fala a mesma API.
      '@desktop': desktop,
    },
  },
  server: {
    // O dominio vive fora da raiz do projeto; sem isto o Vite recusa servi-lo.
    fs: { allow: [process.cwd(), desktop] },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
