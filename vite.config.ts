import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  return {
    plugins: [react(), tailwindcss()],

    // Necesario para GitHub Pages:
    // https://gb-films.github.io/GB-GOAT/
    base: mode === 'production' ? '/GB-GOAT/' : '/',

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },

    server: {
      // Permite desactivar HMR en entornos de edición automatizada.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
