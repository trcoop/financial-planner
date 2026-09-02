// Points Ladle at the app's own vite.config.ts so it resolves JSX/TS through the same
// @vitejs/plugin-react instance the real app build uses, rather than Ladle's default
// react-swc plugin (per the Component Library spec's Ladle setup section).
/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: 'src/ui/components/**/*.stories.{js,jsx,ts,tsx}',
  viteConfig: 'vite.config.ts',
  outDir: '.ladle-build',
  // Without this, Ladle inherits the app's own `base: '/financial-planner/'` from vite.config.ts
  // (merged in alongside the react plugin above) and serves the story catalog from that subpath
  // instead of the site root.
  base: '/',
  addons: {
    a11y: { enabled: true },
  },
}
