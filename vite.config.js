import { defineConfig } from 'vite';

export default defineConfig({
  // 相対パスでビルドし、GitHub Pages などのサブパスでも動くようにする
  base: './',
  build: {
    // three.js 本体を含むため 500kB を超えるのは想定内
    chunkSizeWarningLimit: 1000,
  },
});
