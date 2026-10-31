/**
 * Whether this build's Import page takes the Hardcover "everything" zip (`runtimeConfig.public.importZip`, nuxt.config.ts:
 * `NUXT_PUBLIC_IMPORT_ZIP`, `on` to turn it on; unset, off: the picker takes a CSV only and its copy is today's). Decided at
 * build time, like the cover hosts (`useCoverHosts`). Read in a setup, not after an `await`.
 */
export function useImportZip(): boolean {
  return useRuntimeConfig().public.importZip === 'on'
}
