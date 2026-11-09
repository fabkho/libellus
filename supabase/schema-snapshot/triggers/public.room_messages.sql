CREATE TRIGGER room_messages_check BEFORE INSERT OR UPDATE ON room_messages FOR EACH ROW EXECUTE FUNCTION private.room_messages_check();

CREATE CONSTRAINT TRIGGER room_messages_replies_check AFTER UPDATE OF visibility ON room_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.room_messages_replies_check();

CREATE TRIGGER room_messages_voice_deleted AFTER DELETE ON room_messages FOR EACH ROW WHEN (old.voice_object IS NOT NULL) EXECUTE FUNCTION private.note_voice_gone();

CREATE TRIGGER room_messages_voice_tombstone AFTER UPDATE OF voice_object ON room_messages FOR EACH ROW WHEN (old.voice_object IS NOT NULL AND new.voice_object IS NULL) EXECUTE FUNCTION private.note_voice_gone();
