### slow4g-4x — Chromium, CPU 4x slower, Slow 4G (1.6 Mbit/s down, 150 ms)
chromium 153.0.8010.12, 5 runs, commit 5efb42a2, load average at start 3.27 3.19 2.14. Median per cell, ~ = spread above 15 %.

| step                  | ready ms | LCP ms |   CLS | INP ms | TBT ms | LoAF n | LoAF ms | worst frame | frames>50 | req |  KB | heap MB |
| --------------------- | -------: | -----: | ----: | -----: | -----: | -----: | ------: | ----------: | --------: | --: | --: | ------: |
| a-start-cold          |     2978 |   3708 |     0 |      — |    ~19 |     ~3 |     737 |           — |         — | 170 | 434 |     7.3 |
| a-start-warm          |      344 |    648 |     0 |      — |      0 |     ~2 |    ~216 |           — |         — | 152 |  34 |     7.3 |
| b1-home-to-library    |      192 |      — |     0 |    ~32 |    ~32 |      1 |      91 |         ~67 |         1 |  37 |  19 |    10.4 |
| b2-library-scroll     |     3047 |      — |     0 |      — |      0 |      0 |       0 |         ~67 |         1 |  45 |   7 |    10.4 |
| b3-library-to-profile |     ~216 |      — |     0 |     32 |    ~83 |      2 |     217 |         117 |         3 |  25 |  16 |    12.4 |
| b4-profile-to-home    |      135 |      — |     0 |     32 |      0 |      0 |       0 |         117 |        ~3 |   2 |   0 |    12.7 |
| c1-library-to-book    |      142 |      — | 0.009 |     40 |      0 |     ~1 |     ~51 |         117 |        ~3 |  23 |   4 |    14.6 |
| c2-book-back          |      106 |      — |     0 |    ~40 |      0 |      0 |       0 |         117 |        ~3 |   0 |   0 |    14.3 |
| d1-search-open        |      ~79 |      — |     0 |    ~40 |      0 |      0 |       0 |         117 |        ~3 |   2 |  31 |    13.6 |
| d2-search-type        |     1570 |      — | ~0.42 |     24 |    ~13 |      1 |     ~75 |         117 |        ~4 |  29 | 114 |    17.3 |
| d3-search-close       |      ~62 |      — |     0 |     40 |      0 |      0 |       0 |         117 |        ~4 |   0 |   0 |    15.3 |
| e1-profile-open       |     ~236 |      — |     0 |     32 |    ~59 |      1 |     127 |         133 |         1 |  19 |  23 |    11.3 |
| e2-profile-back       |       85 |      — |     0 |      — |      0 |      0 |       0 |         133 |         1 |   2 |  ~0 |    10.3 |
| f1-home-to-library    |      181 |      — |     0 |     32 |    ~22 |      1 |      80 |         133 |        ~2 |  33 |  12 |    12.8 |
| f2-library-to-profile |      137 |      — |     0 |     32 |      0 |      0 |       0 |         133 |        ~2 |   0 |   0 |    12.5 |
| f3-profile-to-library |      137 |      — |     0 |     32 |      0 |      0 |       0 |         133 |        ~3 |   0 |   0 |    12.3 |
| f4-library-to-profile |      133 |      — |     0 |     32 |      0 |      0 |       0 |         133 |        ~3 |   0 |   0 |    12.5 |
| f5-profile-to-library |      126 |      — |     0 |     32 |      0 |      0 |       0 |         133 |        ~3 |   0 |   0 |    12.9 |

- a-start-cold: LoAF: BH0jUtlZ.js import.then 103ms | CmQdbIpx.js Response.text.then 69ms — LCP element img 9781000000009.jpg/240x360bb.jpg
- a-start-warm: LoAF: BH0jUtlZ.js import.then 190ms — LCP element img 9781000000009.jpg/240x360bb.jpg
- b3-library-to-profile: LoAF: CmQdbIpx.js Response.text.then 112ms | BH0jUtlZ.js ViewTransitionCallback 73ms
- d2-search-type: CLS 0.4203: li 0,0,0,0→12,561,388,68; li 0,0,0,0→12,493,388,68; li 0,0,0,0→12,357,388,68
- e1-profile-open: LoAF: BH0jUtlZ.js ViewTransitionCallback 108ms

