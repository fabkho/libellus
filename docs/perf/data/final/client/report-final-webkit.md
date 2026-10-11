### webkit — WebKit (no throttling available), iPhone 15 viewport
webkit 26.6, 5 runs, commit 5efb42a2, load average at start 2.13 2.28 2.2. Median per cell, ~ = spread above 15 %.

| step                           | ready ms | LCP ms | CLS | INP ms | TBT ms | LoAF n | LoAF ms | worst frame | frames>50 | req |   KB | heap MB |
| ------------------------------ | -------: | -----: | --: | -----: | -----: | -----: | ------: | ----------: | --------: | --: | ---: | ------: |
| a-start-cold                   |     ~136 |   ~308 |   0 |      — |      0 |      0 |       0 |           — |         — | 162 | 1435 |       — |
| a-start-warm                   |      127 |    127 |   0 |      — |      0 |      0 |       0 |           — |         — | 147 |  663 |       — |
| b1-home-to-library             |      ~94 |      — |   0 |     16 |      0 |      0 |       0 |         ~41 |         0 |  51 |   48 |       — |
| b2-library-scroll              |      866 |      — |   0 |      — |      0 |      0 |       0 |         ~41 |         0 |   0 |    0 |       — |
| b3-library-to-profile          |     ~114 |      — |   0 |     16 |      0 |      0 |       0 |         ~45 |         0 |   7 |   19 |       — |
| b4-profile-to-home             |      103 |      — |   0 |     16 |      0 |      0 |       0 |         ~52 |        ~1 |   0 |    0 |       — |
| c1-library-to-book             |     ~108 |      — |   0 |    ~40 |      0 |      0 |       0 |         ~52 |        ~1 |   8 |   60 |       — |
| c2-book-back                   |      ~76 |      — |   0 |    ~16 |      0 |      0 |       0 |         ~52 |        ~1 |   0 |    0 |       — |
| d1-search-open                 |      ~46 |      — |   0 |    ~16 |      0 |      0 |       0 |         ~52 |        ~1 |   0 |    0 |       — |
| d2-search-type (0/5 ok)        |        — |      — |   — |      — |      — |      — |       — |           — |         — |   — |    — |       — |
| d3-search-close                |      ~33 |      — |   0 |     16 |      0 |      0 |       0 |         ~52 |        ~1 |   0 |    0 |       — |
| e1-profile-open                |      113 |      — |   0 |     16 |      0 |      0 |       0 |         ~44 |         0 |   7 |   19 |       — |
| e2-profile-back                |      ~92 |      — |   0 |      — |      0 |      0 |       0 |          49 |         0 |   0 |    0 |       — |
| f1-home-to-library             |     ~128 |      — |   0 |     16 |      0 |      0 |       0 |         ~67 |        ~1 |  51 |  ~48 |       — |
| f2-library-to-profile (0/5 ok) |        — |      — |   — |      — |      — |      — |       — |           — |         — |   — |    — |       — |
| f3-profile-to-library          |      109 |      — |   0 |     16 |      0 |      0 |       0 |         142 |        ~2 |   0 |    0 |       — |
| f4-library-to-profile (0/5 ok) |        — |      — |   — |      — |      — |      — |       — |           — |         — |   — |    — |       — |
| f5-profile-to-library          |     ~106 |      — |   0 |     16 |      0 |      0 |       0 |         142 |        ~3 |   0 |    0 |       — |

- a-start-cold: LCP element img 9781000000009.jpg/240x360bb.jpg
- a-start-warm: LCP element p[home.installHintText] 

