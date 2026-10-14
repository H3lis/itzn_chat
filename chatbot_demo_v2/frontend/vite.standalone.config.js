import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 오프라인 배포용 단일 실행 HTML 번들러 설정
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist-standalone',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100000000, // 모든 자산 인라인 번들링
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
