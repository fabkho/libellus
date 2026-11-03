/**
 * Where the shared chat layer comes from (fabkho/chat, the `@fabkho/chat` dependency pinned to a tag in package.json; its
 * README says how it is used). The twin of ui.config.ts: `extends: chatLayer()`; `CHAT_LAYER=/path/to/chat` points the app at
 * a local checkout instead (`#layers/chat`, which vitest.config.ts maps, follows it).
 *
 * Nothing in the app imports the layer yet (the buddy read's data layer is its first user); extending it only registers its
 * auto-imports, which Nuxt drops from a chunk nobody reaches (tests/chat-layer.test.ts, perf/bundle.ts).
 */
export const chatLayer = () => process.env.CHAT_LAYER || '@fabkho/chat'
