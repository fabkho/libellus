/**
 * Direction d-light — D ("Night Reader") in light mode: identical screens,
 * kit and type, on D's warm Day paper only. A copy of directions/d with its
 * own scope, so the two can sit next to each other in Vergleich.
 */
import { defineDirection, withProps } from '../../contract'
import './fonts/geist.css'
import './fonts/geist-mono.css'
import './fonts/newsreader.css'
import './light.css'
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
  key: 'd-light',
  title: 'Night Reader, light',
  summary:
    'D with the lights on — identical screens, kit and type, only light: warm off-white paper, ink-dark text, hairlines and small precise type (Geist, tabular figures) keep the chrome quiet so the covers carry the colour; the book detail and the Currently reading cards are washed in the cover’s own tones. Search is a command palette with each source reporting in; the tab bar is a floating capsule of three icons. The one accent is the lamp’s amber, darkened to read on paper.',
  toggles: [
    {
      key: 'glow',
      label: 'Cover glow',
      options: [
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
      default: 'on',
    },
    {
      key: 'titles',
      label: 'Book titles',
      options: [
        { value: 'serif', label: 'Serif' },
        { value: 'sans', label: 'Sans' },
      ],
      default: 'serif',
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
