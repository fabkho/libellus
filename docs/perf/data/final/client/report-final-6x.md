### slow4g-6x — Chromium, CPU 6x slower, Slow 4G (1.6 Mbit/s down, 150 ms)
chromium 153.0.8010.12, 5 runs, commit 5efb42a2, load average at start 2.37 2.8 2.24. Median per cell, ~ = spread above 15 %.

| step                  | ready ms | LCP ms |   CLS | INP ms | TBT ms | LoAF n | LoAF ms | worst frame | frames>50 | req |  KB | heap MB |
| --------------------- | -------: | -----: | ----: | -----: | -----: | -----: | ------: | ----------: | --------: | --: | --: | ------: |
| a-start-cold          |     3074 |   3852 |     0 |      — |     58 |      4 |     883 |           — |         — | 170 | 434 |     7.3 |
| a-start-warm          |      539 |    864 |     0 |      — |      0 |     ~3 |    ~394 |           — |         — | 156 |  34 |     7.3 |
| b1-home-to-library    |      262 |      — |     0 |    ~32 |    ~75 |      1 |     139 |         117 |         1 |  37 |  19 |    10.5 |
| b2-library-scroll     |     3051 |      — |     0 |      — |      0 |      0 |       0 |         117 |         1 |  45 |   7 |    10.4 |
| b3-library-to-profile |      270 |      — |     0 |    ~32 |    176 |      2 |     309 |         167 |         3 |  25 |  16 |    12.4 |
| b4-profile-to-home    |      159 |      — |     0 |    ~32 |      0 |      0 |       0 |         167 |         4 |   2 |   0 |    12.8 |
| c1-library-to-book    |      193 |      — | 0.009 |    ~48 |    ~15 |      1 |      83 |         167 |         5 |  23 |   4 |    13.9 |
| c2-book-back          |      130 |      — |     0 |    ~48 |      0 |      0 |       0 |         167 |        ~5 |   0 |   0 |    14.4 |
| d1-search-open        |      100 |      — |     0 |     56 |      0 |      0 |       0 |         167 |        ~5 |   2 |  31 |    13.6 |
| d2-search-type        |     1600 |      — |  0.42 |     24 |     52 |      2 |     175 |         167 |         7 |  29 | 114 |    15.8 |
| d3-search-close       |      ~79 |      — |     0 |    ~40 |      0 |      0 |       0 |         167 |         7 |   0 |   0 |    14.8 |
| e1-profile-open       |      321 |      — |     0 |    ~32 |    117 |      1 |     190 |         200 |         1 |  19 |  23 |    11.3 |
| e2-profile-back       |      102 |      — |     0 |      — |      0 |      0 |       0 |         200 |         2 |   2 |  ~0 |    10.3 |
| f1-home-to-library    |      234 |      — |     0 |    ~32 |    ~57 |      1 |     119 |         200 |         3 |  33 |  12 |    12.8 |
| f2-library-to-profile |      164 |      — |     0 |    ~32 |      0 |      1 |      60 |         200 |         4 |   0 |   0 |    12.6 |
| f3-profile-to-library |      165 |      — |     0 |    ~24 |      0 |      1 |      58 |         200 |         5 |   0 |   0 |    12.4 |
| f4-library-to-profile |      149 |      — |     0 |    ~32 |      0 |      1 |     ~63 |         200 |         6 |   0 |   0 |    12.6 |
| f5-profile-to-library |      161 |      — |     0 |    ~32 |      0 |     ~1 |     ~57 |         200 |         7 |   0 |   0 |    12.3 |

- a-start-cold: LoAF: BH0jUtlZ.js import.then 208ms | CmQdbIpx.js Response.text.then 110ms — LCP element img 9781000000009.jpg/240x360bb.jpg
- a-start-warm: LoAF: BH0jUtlZ.js import.then 302ms | BH0jUtlZ.js https://localhost:3102/_nuxt/BH0jUtlZ.js 39ms — LCP element img 9781000000009.jpg/240x360bb.jpg
- b1-home-to-library: LoAF: (none) TimerHandler:setTimeout 126ms
- b3-library-to-profile: LoAF: CmQdbIpx.js Response.text.then 169ms | BH0jUtlZ.js ViewTransitionCallback 111ms
- d2-search-type: CLS 0.4203: li 0,0,0,0→12,561,388,68; li 0,0,0,0→12,493,388,68; li 0,0,0,0→12,357,388,68 — LoAF: C_EemRa5.js Response.json.then 150ms
- e1-profile-open: LoAF: BH0jUtlZ.js ViewTransitionCallback 167ms
- f1-home-to-library: LoAF: (none) TimerHandler:setTimeout 108ms

