// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  site: 'https://sqdk.io',
  integrations: [tailwind()],
  // Fetch pages as soon as a link is hovered, touched or focused, so navigation feels instant.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
});
