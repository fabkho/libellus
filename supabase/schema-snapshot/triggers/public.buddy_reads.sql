CREATE TRIGGER buddy_reads_live_status AFTER UPDATE OF status ON buddy_reads FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION private.buddy_read_live();
