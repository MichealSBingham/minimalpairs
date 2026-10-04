import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: process.env.SITE_URL || 'https://minimalpairs.co',
  output: 'static',
  integrations: [react()],
  trailingSlash: 'never',
  vite: {
    // Astro check/build use production React; a running dev server must not
    // reuse that dependency cache for development JSX transforms.
    cacheDir: process.env.NODE_ENV === 'production' ? './node_modules/.vite-production' : './node_modules/.vite-development',
    server: { allowedHosts: true },
  },
});
