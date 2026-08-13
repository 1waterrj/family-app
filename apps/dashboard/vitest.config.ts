import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'dashboard',
    environment: 'jsdom',
    globals: true,
    pool: 'threads',
    setupFiles: ['./test/setup.ts'],
    include: ['./test/**/*.test.{ts,tsx}'],
    css: true,
  },
});
