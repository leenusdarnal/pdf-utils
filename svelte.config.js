import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: '404.html'
    }),
    paths: {
      // GitHub Pages hosts this project under /pdf-utils; local development
      // and ordinary builds use the site root.
      base: process.env.BASE_PATH ?? ''
    }
  }
};

export default config;
