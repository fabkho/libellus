CREATE TRIGGER follows_likes_on_end AFTER DELETE ON follows FOR EACH ROW EXECUTE FUNCTION private.likes_on_follow_end();
