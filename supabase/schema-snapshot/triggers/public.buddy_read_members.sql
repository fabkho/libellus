CREATE TRIGGER buddy_read_members_gone AFTER DELETE ON buddy_read_members FOR EACH ROW EXECUTE FUNCTION private.buddy_member_gone();
