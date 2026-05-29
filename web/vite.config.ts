import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 시 /api 요청은 NestJS(3000)로 프록시.
// 빌드 산출물(dist)은 Docker에서 server/public 으로 복사되어 서빙된다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
