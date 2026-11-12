import { defineConfig } from 'vitest/config';
import beacon from '@beacon/dom/vite';

export default defineConfig({
  plugins: [beacon()],
  test: { environment: 'happy-dom' },
});
