CREATE TRIGGER blocks_likes_on_block AFTER INSERT ON blocks FOR EACH ROW EXECUTE FUNCTION private.likes_on_block();
