/**
 * Direction `a` — "Books". Apple Books on iOS 26, done calmer: covers are the
 * heroes on warm matte paper, and only the chrome floats as frosted glass
 * (capsule tab bar, round toolbar buttons, the bottom search field, menus).
 * Serif for what you read, Inter for what you tap.
 */
import { defineDirection, withProps } from '../../contract'
import './fonts/inter.css'
import './fonts/source-serif-4.css'
import './fonts/newsreader.css'
import './a.css'
import AddSheet from './screens/AddSheet.vue'
import BookDetail from './screens/BookDetail.vue'
import Collection from './screens/Collection.vue'
import Collections from './screens/Collections.vue'
import FinishSheet from './screens/FinishSheet.vue'
import Home from './screens/Home.vue'
import HomeEmpty from './screens/HomeEmpty.vue'
import Library from './screens/Library.vue'
import ManualBook from './screens/ManualBook.vue'
import Search from './screens/Search.vue'
import SignIn from './screens/SignIn.vue'

export default defineDirection({
  key: 'a',
  title: 'Books',
  summary:
    'Apple Books on iOS 26, done calmer: a cover-first library on warm matte paper. Covers keep their real proportions and carry the colour — book detail sits on a soft field mixed from the cover’s own palette — while only the chrome floats as frosted glass: a capsule tab bar with a detached search circle, round back and action buttons, the search field at the bottom of the screen, menus. Serif for everything you read (titles, reviews, numbers), Inter for everything you tap, one accent colour for the one action that matters on each screen.',
  toggles: [
    {
      key: 'accent',
      label: 'Accent',
      options: [
        { value: 'ember', label: 'Ember' },
        { value: 'indigo', label: 'Indigo' },
        { value: 'moss', label: 'Moss' },
      ],
      default: 'ember',
    },
    {
      key: 'glass',
      label: 'Glass',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'subtle', label: 'Subtle' },
        { value: 'strong', label: 'Strong' },
      ],
      default: 'subtle',
    },
    {
      key: 'serif',
      label: 'Serif',
      options: [
        { value: 'source', label: 'Source Serif' },
        { value: 'newsreader', label: 'Newsreader' },
      ],
      default: 'source',
    },
  ],
  screens: {
    'sign-in': SignIn,
    home: Home,
    'home-empty': HomeEmpty,
    'search-typing': withProps(Search, { state: 'typing' }),
    'search-results': withProps(Search, { state: 'results' }),
    'search-empty': withProps(Search, { state: 'empty' }),
    'manual-book': ManualBook,
    'book-new': withProps(BookDetail, { state: 'new' }),
    'add-sheet': AddSheet,
    'book-reading': withProps(BookDetail, { state: 'reading' }),
    'finish-sheet': FinishSheet,
    'book-finished': withProps(BookDetail, { state: 'finished' }),
    'library-want': withProps(Library, { status: 'want_to_read' }),
    'library-reading': withProps(Library, { status: 'reading' }),
    'library-finished': withProps(Library, { status: 'finished' }),
    collections: Collections,
    collection: Collection,
  },
})
