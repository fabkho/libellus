// Libellus: the sandbox of every page frame, decided once by the reader's engine
// (reader/engine.ts, `frameSandbox`). foliate's default allows scripts, which WebKit
// needs to deliver events to the frame (https://bugs.webkit.org/show_bug.cgi?id=218086);
// where a scriptless frame still gets its events, the engine drops `allow-scripts`.
export const frame = { sandbox: 'allow-same-origin allow-scripts' }
