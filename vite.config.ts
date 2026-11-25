import { defineConfig, type Plugin } from 'vite';
import { APP_NAME, APP_TAGLINE } from './src/app/brand.ts';
import { buildVersion, precacheList, type BuiltFile } from './src/sw/cache-plan.ts';

const THEME = '#09627b';

/** The install manifest, from the name in src/app/brand.ts. */
function manifest(): string {
  return JSON.stringify(
    {
      name: APP_NAME,
      short_name: APP_NAME,
      description: APP_TAGLINE,
      start_url: './',
      scope: './',
      display: 'standalone',
      orientation: 'any',
      background_color: THEME,
      theme_color: THEME,
      categories: ['education', 'music'],
      icons: [
        { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  );
}

/**
 * Makes the app installable and usable offline:
 * - puts the app name into index.html (%APP_NAME%, %APP_TAGLINE%),
 * - serves (dev) or writes (build) manifest.webmanifest,
 * - at build time only, bundles src/sw/sw.ts into sw.js with this build's
 *   version and file lists filled in. The dev server never gets a worker.
 */
function pwa(): Plugin {
  let isBuild = false;
  let swRef = '';
  return {
    name: 'piano-pwa',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%APP_NAME%', APP_NAME).replaceAll('%APP_TAGLINE%', APP_TAGLINE),
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.endsWith('/manifest.webmanifest')) return next();
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(manifest());
      });
    },
    buildStart() {
      if (!isBuild) return;
      swRef = this.emitFile({ type: 'chunk', id: 'src/sw/sw.ts', fileName: 'sw.js' });
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest() });
    },
    generateBundle(_options, bundle) {
      if (!isBuild) return;
      const swName = this.getFileName(swRef);
      const files: BuiltFile[] = [];
      let entry: string[] = [];
      for (const [fileName, item] of Object.entries(bundle)) {
        if (fileName === swName) continue;
        const size = item.type === 'chunk' ? item.code.length : typeof item.source === 'string' ? item.source.length : item.source.byteLength;
        files.push({ fileName, size });
        if (item.type === 'chunk' && item.isEntry) {
          entry = [fileName, ...item.imports, ...[...(item.viteMetadata?.importedCss ?? [])]];
        }
      }
      // Public files (icons) are copied after the bundle is written; list the ones the shell needs.
      for (const icon of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png']) {
        files.push({ fileName: icon, size: 0 });
      }
      // The Latin fonts every screen uses (the extended Latin files are cached when first needed).
      for (const font of ['fonts/fredoka-latin.woff2', 'fonts/atkinson-regular-latin.woff2', 'fonts/atkinson-bold-latin.woff2']) {
        files.push({ fileName: font, size: 0 });
      }
      const names = files.map((f) => f.fileName);
      const version = buildVersion(names);
      const precache = precacheList(files, entry);
      const assets = names.filter((n) => n.startsWith('assets/'));
      const sw = bundle[swName];
      if (!sw || sw.type !== 'chunk') throw new Error('The offline worker was not built.');
      if (sw.imports.length > 0) throw new Error('The offline worker must be a single file without imports.');
      sw.code = sw.code
        .replaceAll('__PIANO_VERSION__', JSON.stringify(version))
        .replaceAll('__PIANO_PRECACHE__', JSON.stringify(precache))
        .replaceAll('__PIANO_ASSETS__', JSON.stringify(assets));
    },
  };
}

export default defineConfig({
  // Hosting under a folder (for example GitHub Pages at /open-piano/): set PIANO_BASE to that folder.
  base: process.env.PIANO_BASE ?? '/',
  plugins: [pwa()],
  // The end-to-end tests run their own dev server: no live reload there, so
  // editing a file while a long test runs does not reload the page under it.
  server: process.env.PIANO_E2E ? { hmr: false } : {},
  // The song splitter's runtime is only imported inside its worker. Bundled up front, so finding
  // it during the first split does not make the dev server reload the page mid-import.
  optimizeDeps: { include: ['onnxruntime-web/wasm', 'onnxruntime-web/webgpu'] },
});
