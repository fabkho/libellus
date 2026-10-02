/**
 * Direction b — "Editorial". Libellus as a reading journal set like a literary
 * quarterly: display serif titles, small-caps labels, hairline rules, covers
 * as captioned plates, lists as tables of contents, one accent on paper.
 */
import { defineDirection, withProps } from '../../contract'
import './fonts/instrument-serif.css'
import './fonts/playfair-display.css'
import './fonts/newsreader.css'
import './editorial.css'
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
  key: 'b',
  title: 'Editorial',
  summary:
    'Libellus as a reading journal printed like a literary quarterly. Typography leads: big display-serif titles, letter-spaced small-caps labels, hairline rules and one strong accent on paper. Home is this week’s issue with your current books set as features; covers are captioned plates; the Library reads like a table of contents with dotted leaders; reading history is a journal; Ratings are set as figures (3¾) as well as stars.',
  toggles: [
    {
      key: 'accent',
      label: 'Accent',
      options: [
        { value: 'oxblood', label: 'Oxblood' },
        { value: 'ink', label: 'Ink blue' },
        { value: 'forest', label: 'Forest' },
      ],
      default: 'oxblood',
    },
    {
      key: 'display',
      label: 'Display face',
      options: [
        { value: 'modern', label: 'Instrument' },
        { value: 'didone', label: 'Didone' },
      ],
      default: 'modern',
    },
    {
      key: 'paper',
      label: 'Paper',
      options: [
        { value: 'warm', label: 'Warm' },
        { value: 'white', label: 'White' },
      ],
      default: 'warm',
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
