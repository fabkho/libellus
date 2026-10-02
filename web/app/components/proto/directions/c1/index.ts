/**
 * Direction `c1` — "Shelf, calmer". C's bookcase and its small rituals
 * (spines, bookmark, a stamped finish) in A and D's quieter language: matte
 * paper, hairlines, serif for reading and Inter for tapping, one accent,
 * floating glass chrome, light and dark from the same tokens.
 */
import { defineDirection, withProps } from '../../contract'
import './fonts/inter.css'
import './fonts/fraunces.css'
import './fonts/newsreader.css'
import './fonts/geist-mono.css'
import './c1.css'
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
  key: 'c1',
  title: 'Shelf, calmer',
  summary:
    'C’s bookcase, one step towards A and D. The Library is still a shelf of spines in each cover’s colour, thick for long books; the book you are reading still carries a bookmark and finishing still leaves a small date stamp. Everything around them is calmer: flat matte paper instead of grain, light oak instead of a carpenter’s plank, a soft serif for titles and Inter for controls, one ember accent, hairline cards and the floating glass tab bar with its own search circle. Light and Dark are the same design with two sets of tokens — the way A and D could become one.',
  toggles: [
    {
      key: 'theme',
      label: 'Theme',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      default: 'light',
    },
    {
      key: 'view',
      label: 'Shelf',
      options: [
        { value: 'spines', label: 'Spines' },
        { value: 'stacks', label: 'Stacks' },
        { value: 'covers', label: 'Covers' },
      ],
      default: 'spines',
    },
    {
      key: 'type',
      label: 'Serif',
      options: [
        { value: 'soft', label: 'Fraunces' },
        { value: 'classic', label: 'Newsreader' },
      ],
      default: 'soft',
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
