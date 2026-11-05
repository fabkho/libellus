CREATE TRIGGER buddy_freeze_on_member_unlink BEFORE UPDATE OF entry_id ON buddy_read_members FOR EACH ROW WHEN (new.entry_id IS NULL AND old.entry_id IS NOT NULL) EXECUTE FUNCTION private.buddy_on_member_unlink();

CREATE TRIGGER buddy_read_members_cursors_gone AFTER DELETE ON buddy_read_members FOR EACH ROW EXECUTE FUNCTION private.buddy_cursors_gone();

CREATE TRIGGER buddy_read_members_gone AFTER DELETE ON buddy_read_members FOR EACH ROW EXECUTE FUNCTION private.buddy_member_gone();

CREATE TRIGGER buddy_read_members_live_delete AFTER DELETE ON buddy_read_members FOR EACH ROW EXECUTE FUNCTION private.buddy_member_live();

CREATE TRIGGER buddy_read_members_live_insert AFTER INSERT ON buddy_read_members FOR EACH ROW EXECUTE FUNCTION private.buddy_member_live();

CREATE TRIGGER buddy_read_members_live_update AFTER UPDATE OF joined_at, role, auto_through, hand_through ON buddy_read_members FOR EACH ROW WHEN (new.joined_at IS NOT NULL AND (old.joined_at IS DISTINCT FROM new.joined_at OR old.role IS DISTINCT FROM new.role OR old.read_through IS DISTINCT FROM new.read_through)) EXECUTE FUNCTION private.buddy_member_live();

CREATE TRIGGER buddy_refresh_on_member_link AFTER UPDATE OF entry_id, joined_at ON buddy_read_members FOR EACH ROW WHEN (new.entry_id IS NOT NULL AND (old.entry_id IS DISTINCT FROM new.entry_id OR old.joined_at IS DISTINCT FROM new.joined_at)) EXECUTE FUNCTION private.buddy_on_member_link();
