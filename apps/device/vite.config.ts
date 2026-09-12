import { defineConfig } from 'vite';

export default defineConfig({
  envDir: '../..',
  server: {
    port: 4174,
  },
  preview: {
    port: 4174,
  },
});
