CREATE TRIGGER room_messages_check BEFORE INSERT OR UPDATE ON room_messages FOR EACH ROW EXECUTE FUNCTION private.room_messages_check();

CREATE CONSTRAINT TRIGGER room_messages_replies_check AFTER UPDATE OF visibility ON room_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.room_messages_replies_check();
