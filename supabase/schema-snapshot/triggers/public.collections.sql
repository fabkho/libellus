CREATE TRIGGER collections_touch BEFORE UPDATE ON collections FOR EACH ROW EXECUTE FUNCTION collections_touch();
