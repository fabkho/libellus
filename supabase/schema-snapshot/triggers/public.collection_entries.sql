CREATE TRIGGER collection_entries_same_member BEFORE INSERT OR UPDATE OF collection_id, entry_id ON collection_entries FOR EACH ROW EXECUTE FUNCTION collection_entries_same_member();

CREATE TRIGGER collection_entries_touch AFTER INSERT OR DELETE OR UPDATE OF "position" ON collection_entries FOR EACH ROW EXECUTE FUNCTION collection_entries_touch();
