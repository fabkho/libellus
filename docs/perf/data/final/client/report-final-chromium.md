### chromium — Chromium, unthrottled
chromium 153.0.8010.12, 5 runs, commit 5efb42a2, load average at start 2.12 2.46 2.23. Median per cell, ~ = spread above 15 %.

| step                  | ready ms | LCP ms |    CLS | INP ms | TBT ms | LoAF n | LoAF ms | worst frame | frames>50 | req |  KB | heap MB |
| --------------------- | -------: | -----: | -----: | -----: | -----: | -----: | ------: | ----------: | --------: | --: | --: | ------: |
| a-start-cold          |       93 |    432 |      0 |      — |      0 |      0 |       0 |           — |         — | 170 | 833 |     7.3 |
| a-start-warm          |       85 |    380 |      0 |      — |      0 |      0 |       0 |           — |         — | 153 |  34 |     7.3 |
| b1-home-to-library    |     ~119 |      — |      0 |     32 |      0 |      0 |       0 |          17 |         0 |  59 |  19 |    10.9 |
| b2-library-scroll     |     3025 |      — |      0 |      — |      0 |      0 |       0 |          17 |         0 |  23 |   8 |     9.8 |
| b3-library-to-profile |      135 |      — |      0 |     32 |      0 |      0 |       0 |         ~50 |         0 |  25 |  16 |    11.9 |
| b4-profile-to-home    |      122 |      — |      0 |     32 |      0 |      0 |       0 |         ~50 |         0 |   2 |  ~0 |    12.8 |
| c1-library-to-book    |      126 |      — | ~0.009 |    ~32 |      0 |      0 |       0 |         ~50 |         0 |  23 |   4 |    14.4 |
| c2-book-back          |      ~68 |      — |      0 |    ~48 |      0 |      0 |       0 |         ~50 |         0 |   0 |   0 |    14.2 |
| d1-search-open        |      ~56 |      — |      0 |    ~32 |      0 |      0 |       0 |         ~50 |         0 |   2 |  31 |    13.9 |
| d2-search-type        |     1046 |      — |      0 |    ~24 |      0 |      0 |       0 |         ~50 |         0 |  29 | 114 |    16.6 |
| d3-search-close       |      ~56 |      — |      0 |     40 |      0 |      0 |       0 |         ~50 |         0 |   0 |   0 |    15.5 |
| e1-profile-open       |     ~135 |      — |      0 |     32 |      0 |      0 |       0 |         ~50 |        ~1 |  19 |  23 |    10.8 |
| e2-profile-back       |      ~78 |      — |      0 |      — |      0 |      0 |       0 |         ~50 |        ~1 |   2 |  ~0 |    10.1 |
| f1-home-to-library    |      126 |      — |      0 |     32 |      0 |      0 |       0 |         ~50 |        ~1 |  55 |  12 |    12.8 |
| f2-library-to-profile |      127 |      — |      0 |     32 |      0 |      0 |       0 |         ~50 |        ~1 |   0 |   0 |    12.2 |
| f3-profile-to-library |      120 |      — |      0 |     32 |      0 |      0 |       0 |         ~50 |        ~1 |   0 |   0 |    12.1 |
| f4-library-to-profile |      118 |      — |      0 |     32 |      0 |      0 |       0 |         ~50 |        ~1 |   0 |   0 |    12.2 |
| f5-profile-to-library |      124 |      — |      0 |     32 |      0 |      0 |       0 |         ~50 |        ~1 |   0 |   0 |    12.7 |

- a-start-cold: LCP element img 9781000000009.jpg/240x360bb.jpg
- a-start-warm: LCP element img 9781000000009.jpg/240x360bb.jpg

