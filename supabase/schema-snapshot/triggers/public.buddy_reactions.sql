CREATE TRIGGER buddy_reactions_live AFTER INSERT OR DELETE OR UPDATE OF emoji ON buddy_reactions FOR EACH ROW EXECUTE FUNCTION private.buddy_reaction_live();
