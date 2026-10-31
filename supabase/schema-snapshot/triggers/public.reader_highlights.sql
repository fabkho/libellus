CREATE TRIGGER reader_highlights_forward_only BEFORE UPDATE ON reader_highlights FOR EACH ROW EXECUTE FUNCTION private.reader_highlights_forward_only();
