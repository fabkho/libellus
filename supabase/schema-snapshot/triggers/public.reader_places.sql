CREATE TRIGGER reader_places_forward_only BEFORE UPDATE ON reader_places FOR EACH ROW EXECUTE FUNCTION private.reader_places_forward_only();
