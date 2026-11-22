import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Os mesmos apelidos do vite.config: ha testes que alcancam codigo de src.
  resolve: {
    alias: {
      '@': dir('./src'),
      '@shared': dir('./shared'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
