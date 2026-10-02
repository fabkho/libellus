/**
 * Direction d — "Night Reader". A dark, warm room and a reading lamp: near-black
 * paper, thin lines, small precise type, and every screen lit by the colours of
 * the cover it shows. Search is a command palette; the tab bar is a quiet
 * floating capsule.
 */
import { defineDirection, withProps } from '../../contract'
import './fonts/geist.css'
import './fonts/geist-mono.css'
import './fonts/newsreader.css'
import './night.css'
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
  key: 'd',
  title: 'Night Reader',
  summary:
    'A reading lamp in a dark room. Warm near-black, hairlines and small precise type (Geist, tabular figures) keep the chrome quiet so the covers glow: the book detail and the Currently reading cards take their light from the cover’s own colours. Search is a command palette with each source reporting in; the tab bar is a floating capsule of three icons. Dark is the pitch; Dim and Day show it holds up with the lights on.',
  toggles: [
    {
      key: 'theme',
      label: 'Room',
      options: [
        { value: 'night', label: 'Night' },
        { value: 'dim', label: 'Dim' },
        { value: 'day', label: 'Day' },
      ],
      default: 'night',
    },
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
