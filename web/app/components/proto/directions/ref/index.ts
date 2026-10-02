/**
 * Direction `ref` — the wireframe. Every screen key, grey and token-free, to
 * show what each screen contains. The template the design directions copy:
 * `cp -r directions/ref directions/<key>`, then restyle (README.md).
 */
import { defineDirection, withProps } from '../../contract'
import './ref.css'
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
  key: 'ref',
  title: 'Wireframe',
  summary:
    'Structure only: what every screen holds and which state it is in, in plain grey with no design decisions. Dashed notes mark behaviour a still frame cannot show. Copy this folder to start a direction.',
  toggles: [
    {
      key: 'notes',
      label: 'Notes',
      options: [
        { value: 'show', label: 'Show' },
        { value: 'hide', label: 'Hide' },
      ],
      default: 'show',
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
