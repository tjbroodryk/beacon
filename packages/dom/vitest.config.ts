import { defineConfig } from 'vitest/config';
import beacon from './src/vite.ts';

export default defineConfig({
  plugins: [beacon()],
  test: { environment: 'happy-dom' },
});
