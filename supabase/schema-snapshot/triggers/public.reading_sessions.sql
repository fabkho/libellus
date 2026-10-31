CREATE TRIGGER reading_sessions_activity AFTER INSERT OR UPDATE OF outcome, review ON reading_sessions FOR EACH ROW EXECUTE FUNCTION private.activity_on_session();

CREATE TRIGGER reading_sessions_no_future_dates BEFORE INSERT OR UPDATE OF started_on, ended_on ON reading_sessions FOR EACH ROW EXECUTE FUNCTION reading_sessions_no_future_dates();

CREATE TRIGGER reading_sessions_shelf_publish AFTER INSERT OR DELETE OR UPDATE OF started_on, ended_on, outcome, rating, review ON reading_sessions FOR EACH ROW EXECUTE FUNCTION private.shelf_publish_on_session();

CREATE TRIGGER reading_sessions_update_status AFTER INSERT OR DELETE OR UPDATE ON reading_sessions FOR EACH ROW EXECUTE FUNCTION reading_sessions_update_status();
