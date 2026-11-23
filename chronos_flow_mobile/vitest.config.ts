import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const desktop = path.resolve(dir('.'), '..', 'chronos_flow_v2');

export default defineConfig({
  resolve: {
    alias: {
      '@': dir('./src'),
      '@db': dir('./db'),
      '@core': path.join(desktop, 'server', 'domain'),
      '@shared': path.join(desktop, 'shared'),
      '@ia': path.join(desktop, 'server', 'modules', 'ai'),
      '@desktop': desktop,
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
