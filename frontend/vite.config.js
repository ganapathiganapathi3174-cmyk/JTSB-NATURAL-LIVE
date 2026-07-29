import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 120000,
        proxyTimeout: 120000,
      },
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    esbuild: {
      drop: ['debugger'],
      pure: ['console.log', 'console.info', 'console.warn', 'console.debug'],
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', 'framer-motion'],
          admin: [
            './src/pages/FirebaseAdminDashboardPage.jsx',
            './src/pages/FirebaseAdminPaymentsPage.jsx',
            './src/pages/FirebaseAdminUsersPage.jsx',
            './src/pages/FirebaseAdminTopupsPage.jsx',
            './src/pages/FirebaseAdminUPIPaymentsPage.jsx',
            './src/pages/FirebaseAdminToolsPage.jsx',
            './src/pages/FirebaseAdminQueuePage.jsx',
            './src/pages/FirebaseAdminStatusPage.jsx',
            './src/pages/FirebaseAdminCyclesPage.jsx',
            './src/pages/AdminChat.jsx',
            './src/pages/AdminMessageHistory.jsx',
            './src/pages/AdminPendingPaymentsPage.jsx',
            './src/pages/AdminUpgradeRequestsPage.jsx',
            './src/pages/AdminSponsorTransfersPage.jsx',
          ],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  optimizeDeps: {
    include: [],
  },
});
