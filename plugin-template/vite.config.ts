import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as { id: string };

// `npm run dev` / `npm run build` write straight into the WinNook plugin folder.
// Override with WINNOOK_PLUGINS_DIR to deploy elsewhere.
const pluginsDir = process.env.WINNOOK_PLUGINS_DIR ?? join(process.env.APPDATA ?? '', 'WinNook', 'plugins');
const outDir = resolve(pluginsDir, manifest.id);

const copyManifest = (): Plugin => ({
  name: 'copy-manifest',
  buildStart() {
    this.addWatchFile(resolve('manifest.json'));
  },
  writeBundle() {
    mkdirSync(outDir, { recursive: true });
    copyFileSync('manifest.json', join(outDir, 'manifest.json'));
  },
});

export default defineConfig({
  plugins: [copyManifest()],
  esbuild: { jsx: 'automatic' },
  build: {
    outDir,
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    lib: { entry: 'src/index.tsx', formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: {
      // Provided by WinNook at runtime – never bundle these.
      external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@winnook/sdk'],
    },
  },
});
