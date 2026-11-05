CREATE TRIGGER buddy_messages_live_deleted AFTER UPDATE OF deleted_at ON buddy_messages FOR EACH ROW WHEN (old.deleted_at IS NULL AND new.deleted_at IS NOT NULL) EXECUTE FUNCTION private.buddy_message_deleted();

CREATE TRIGGER buddy_messages_live_new AFTER INSERT ON buddy_messages FOR EACH ROW EXECUTE FUNCTION private.buddy_message_new();

CREATE TRIGGER buddy_messages_voice_deleted AFTER DELETE ON buddy_messages FOR EACH ROW WHEN (old.voice_mime IS NOT NULL) EXECUTE FUNCTION private.buddy_voice_gone();

CREATE TRIGGER buddy_messages_voice_tombstone AFTER UPDATE OF voice_mime ON buddy_messages FOR EACH ROW WHEN (old.voice_mime IS NOT NULL AND new.voice_mime IS NULL) EXECUTE FUNCTION private.buddy_voice_gone();
