### slow4g-4x — Chromium, CPU 4x slower, Slow 4G (1.6 Mbit/s down, 150 ms)
chromium 153.0.8010.12, 5 runs, commit 5efb42a2, load average at start 3.61 3.36 2.75. Median per cell, ~ = spread above 15 %.

| step                  | ready ms | LCP ms |   CLS | INP ms | TBT ms | LoAF n | LoAF ms | worst frame | frames>50 | req |  KB | heap MB |
| --------------------- | -------: | -----: | ----: | -----: | -----: | -----: | ------: | ----------: | --------: | --: | --: | ------: |
| a-start-cold          |     2993 |   3716 |     0 |      — |    ~21 |      3 |     723 |           — |         — | 170 | 434 |     7.3 |
| a-start-warm          |      343 |    636 |     0 |      — |      0 |      2 |     217 |           — |         — | 152 |  34 |     7.3 |
| b1-home-to-library    |      194 |      — |     0 |     32 |    ~30 |      1 |      90 |         ~67 |         1 |  37 |  19 |    10.4 |
| b2-library-scroll     |     3048 |      — |     0 |      — |      0 |      0 |       0 |         ~67 |         1 |  45 |   7 |    10.4 |
| b3-library-to-profile |      204 |      — |     0 |     32 |    ~78 |      2 |    ~213 |        ~117 |         3 |  25 |  16 |    12.4 |
| b4-profile-to-home    |      134 |      — |     0 |     32 |      0 |      0 |       0 |        ~117 |         3 |   2 |   0 |    12.2 |
| c1-library-to-book    |      135 |      — | 0.009 |     40 |      0 |     ~1 |     ~51 |        ~117 |         3 |  23 |   4 |    14.7 |
| c2-book-back          |      105 |      — |     0 |    ~40 |      0 |      0 |       0 |        ~117 |         3 |   0 |   0 |    13.4 |
| d1-search-open        |      ~70 |      — |     0 |     40 |      0 |      0 |       0 |        ~117 |         3 |   2 |  31 |    13.6 |
| d2-search-type        |     1574 |      — |  0.42 |     24 |    ~12 |     ~1 |     ~77 |        ~117 |        ~4 |  29 | 114 |    17.5 |
| d3-search-close       |      ~69 |      — |     0 |     40 |      0 |      0 |       0 |        ~117 |        ~4 |   0 |   0 |    15.1 |
| e1-profile-open       |      228 |      — |     0 |     32 |     57 |      1 |     126 |         133 |         1 |  19 |  23 |    11.3 |
| e2-profile-back       |      ~84 |      — |     0 |      — |      0 |      0 |       0 |         133 |        ~2 |   2 |  ~0 |    10.2 |
| f1-home-to-library    |      179 |      — |     0 |     32 |    ~19 |      1 |      76 |         133 |        ~2 |  33 |  12 |    12.7 |
| f2-library-to-profile |      134 |      — |     0 |     32 |      0 |      0 |       0 |         133 |        ~2 |   0 |   0 |    12.5 |
| f3-profile-to-library |      135 |      — |     0 |     32 |      0 |      0 |       0 |         133 |        ~2 |   0 |   0 |    12.2 |
| f4-library-to-profile |     ~133 |      — |     0 |    ~32 |      0 |      0 |       0 |         133 |        ~2 |   0 |   0 |    12.5 |
| f5-profile-to-library |      133 |      — |     0 |     32 |      0 |      0 |       0 |         133 |        ~3 |   0 |   0 |      13 |

- a-start-cold: LoAF: BH0jUtlZ.js import.then 100ms | CmQdbIpx.js Response.text.then 73ms — LCP element img 9781000000009.jpg/240x360bb.jpg
- a-start-warm: LoAF: BH0jUtlZ.js import.then 191ms — LCP element img 9781000000009.jpg/240x360bb.jpg
- b3-library-to-profile: LoAF: CmQdbIpx.js Response.text.then 107ms | BH0jUtlZ.js ViewTransitionCallback 72ms
- d2-search-type: CLS 0.4203: li 0,0,0,0→12,561,388,68; li 0,0,0,0→12,357,388,68; li 0,0,0,0→12,85,388,68
- e1-profile-open: LoAF: BH0jUtlZ.js ViewTransitionCallback 106ms

