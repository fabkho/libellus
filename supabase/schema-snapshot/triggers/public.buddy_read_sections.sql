CREATE TRIGGER buddy_read_sections_live_delete AFTER DELETE ON buddy_read_sections REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.buddy_sections_live();

CREATE TRIGGER buddy_read_sections_live_insert AFTER INSERT ON buddy_read_sections REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.buddy_sections_live();

CREATE TRIGGER buddy_read_sections_live_update AFTER UPDATE ON buddy_read_sections REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.buddy_sections_live();

CREATE TRIGGER buddy_refresh_on_sections_delete AFTER DELETE ON buddy_read_sections REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.buddy_on_sections_deleted();

CREATE TRIGGER buddy_refresh_on_sections_insert AFTER INSERT ON buddy_read_sections REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.buddy_on_sections_inserted();

CREATE TRIGGER buddy_refresh_on_sections_update AFTER UPDATE ON buddy_read_sections REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.buddy_on_sections_updated();
