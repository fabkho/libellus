CREATE TRIGGER library_entries_activity AFTER INSERT ON library_entries FOR EACH ROW EXECUTE FUNCTION private.activity_on_entry();

CREATE TRIGGER library_entries_cover_gc_grace AFTER INSERT ON library_entries FOR EACH ROW EXECUTE FUNCTION private.cover_gc_entry_added();

CREATE TRIGGER library_entries_derive_status BEFORE INSERT OR UPDATE ON library_entries FOR EACH ROW EXECUTE FUNCTION library_entries_derive_status();

CREATE TRIGGER library_entries_shelf_publish AFTER INSERT OR DELETE OR UPDATE OF book_id, page_count_override ON library_entries FOR EACH ROW EXECUTE FUNCTION private.shelf_publish_on_entry();

CREATE TRIGGER reading_page_books_entry_gone AFTER DELETE ON library_entries FOR EACH ROW EXECUTE FUNCTION private.reading_page_books_entry_gone();

CREATE TRIGGER reading_page_books_entry_moved AFTER UPDATE OF book_id ON library_entries FOR EACH ROW EXECUTE FUNCTION private.reading_page_books_entry_moved();
