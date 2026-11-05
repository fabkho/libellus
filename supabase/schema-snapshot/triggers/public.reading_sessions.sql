CREATE TRIGGER buddy_refresh_on_session_delete AFTER DELETE ON reading_sessions FOR EACH ROW EXECUTE FUNCTION private.buddy_on_session();

CREATE TRIGGER buddy_refresh_on_session_insert AFTER INSERT ON reading_sessions FOR EACH ROW EXECUTE FUNCTION private.buddy_on_session();

CREATE TRIGGER buddy_refresh_on_session_update AFTER UPDATE OF progress_page, progress_percent, outcome, ended_on, started_on ON reading_sessions FOR EACH ROW WHEN (old.progress_page IS DISTINCT FROM new.progress_page OR old.progress_percent IS DISTINCT FROM new.progress_percent OR old.outcome IS DISTINCT FROM new.outcome OR old.ended_on IS DISTINCT FROM new.ended_on OR old.started_on IS DISTINCT FROM new.started_on) EXECUTE FUNCTION private.buddy_on_session();

CREATE TRIGGER reading_sessions_activity AFTER INSERT OR UPDATE OF outcome, review ON reading_sessions FOR EACH ROW EXECUTE FUNCTION private.activity_on_session();

CREATE TRIGGER reading_sessions_no_future_dates BEFORE INSERT OR UPDATE OF started_on, ended_on ON reading_sessions FOR EACH ROW EXECUTE FUNCTION reading_sessions_no_future_dates();

CREATE TRIGGER reading_sessions_shelf_publish AFTER INSERT OR DELETE OR UPDATE OF started_on, ended_on, outcome, rating, review ON reading_sessions FOR EACH ROW EXECUTE FUNCTION private.shelf_publish_on_session();

CREATE TRIGGER reading_sessions_update_status AFTER INSERT OR DELETE OR UPDATE ON reading_sessions FOR EACH ROW EXECUTE FUNCTION reading_sessions_update_status();
