# Same-hour A/B, slow4g-4x, 2 series of 5 runs each (10 runs), medians; load 1.4-2.3 at every series start

| step | metric | a9a91c89 | v1.9.1 |
| --- | --- | ---: | ---: |
| a-start-cold | ready | 2838 | 2986 |
| a-start-cold | lcp | 3664 | 3724 |
| a-start-cold | loaf | 1199 | 718 |
| a-start-cold | tbt | 17 | 18 |
| a-start-cold | req | 179 | 170 |
| a-start-cold | kb | 449 | 434 |
| a-start-warm | ready | 342 | 334 |
| a-start-warm | lcp | 356 | 644 |
| a-start-warm | loaf | 163 | 213 |
| a-start-warm | tbt | 0 | 0 |
| a-start-warm | req | 171 | 152 |
| a-start-warm | kb | 93 | 34 |
| b1-home-to-library | ready | 207 | 190 |
| b1-home-to-library | loaf | 110 | 90 |
| b1-home-to-library | tbt | 50 | 31 |
| b1-home-to-library | req | 40 | 37 |
| b1-home-to-library | kb | 111 | 19 |
| b3-library-to-profile | ready | 195 | 194 |
| b3-library-to-profile | loaf | 192 | 196 |
| b3-library-to-profile | tbt | 58 | 66 |
| b3-library-to-profile | req | 26 | 25 |
| b3-library-to-profile | kb | 65 | 16 |
| b4-profile-to-home | ready | 132 | 135 |
| b4-profile-to-home | loaf | 0 | 0 |
| b4-profile-to-home | tbt | 0 | 0 |
| b4-profile-to-home | req | 5 | 2 |
| b4-profile-to-home | kb | 93 | 0 |

JS+CSS files requested before Home is shown (cold start): files / KB brotli / domInteractive ms / DOMContentLoaded ms

| | files | KB | domInteractive | DCL |
| --- | ---: | ---: | ---: | ---: |
| a9a91c89 | 76 | 247 | 1190 | 2015 |
| v1.9.1 | 93 | 330 | 712 | 1343 |
