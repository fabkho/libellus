import { test } from './fixtures'
import { bookOpenFlows } from './bookOpenFlows'

// The same flows in Chromium (Chrome and Android's WebView): the cover's flight is Web Animations in both.
test.use({ browserName: 'chromium' })
bookOpenFlows()
