CREATE TRIGGER books_cover_key_follows_cover BEFORE UPDATE OF cover_url ON books FOR EACH ROW WHEN (private.cover_artwork(old.cover_url) IS DISTINCT FROM private.cover_artwork(new.cover_url)) EXECUTE FUNCTION private.books_clear_cover_key();

CREATE TRIGGER books_enrich AFTER INSERT ON books FOR EACH ROW WHEN (new.owner_id IS NULL) EXECUTE FUNCTION private.enrich_on_book();

CREATE TRIGGER books_no_client_description BEFORE INSERT ON books FOR EACH ROW EXECUTE FUNCTION private.books_no_client_description();

CREATE TRIGGER books_search_words AFTER INSERT OR UPDATE OF title, authors ON books FOR EACH ROW EXECUTE FUNCTION private.book_search_sync();
