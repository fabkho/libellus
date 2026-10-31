CREATE TRIGGER feedback_rate_limit BEFORE INSERT ON feedback FOR EACH ROW EXECUTE FUNCTION private.feedback_rate_limit();
