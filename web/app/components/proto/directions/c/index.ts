/**
 * Direction `c` — "Shelf". Books as physical objects: spines on wooden
 * shelves, piles, an open book with a bookmark, a library card stamped when
 * you finish. The metaphors dress the key moments; search and lists stay
 * quick and legible.
 */
import { defineDirection, withProps } from '../../contract'
import './fonts/bricolage-grotesque.css'
import './fonts/young-serif.css'
import './fonts/courier-prime.css'
import './shelf.css'
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
  key: 'c',
  title: 'Shelf',
  summary:
    'Books as objects you can hold. The Library is a real bookcase: spines in each cover’s colour, thick for long books, with typed call-number stickers for dates and a mustard dot for the Rating. The book you are reading carries a bookmark, finishing one means filling in its library card and getting a red date stamp. Chunky, warm and a little bouncy, but search and lists stay plain and fast.',
  toggles: [
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
      key: 'palette',
      label: 'Palette',
      options: [
        { value: 'wood', label: 'Warm wood' },
        { value: 'pastel', label: 'Pastel' },
        { value: 'ink', label: 'Ink' },
      ],
      default: 'wood',
    },
    {
      key: 'texture',
      label: 'Texture',
      options: [
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
      default: 'on',
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
