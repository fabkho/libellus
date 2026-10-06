// Builds the measure page (scripts/measure.mjs): the engine as production would split it.
import { fileURLToPath } from 'node:url'
export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  logLevel: 'warn',
  build: {
    outDir: process.env.OUT ?? '/tmp/libellus-reader-protos/measure-dist',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    assetsInlineLimit: 0,
  },
}
