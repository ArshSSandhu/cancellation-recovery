-- Applied only to the selected hosted database by the operator, not by the app.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO recovery_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM recovery_app;
GRANT SELECT ON identities,clinicians,slots TO recovery_app;
-- SELECT ... FOR UPDATE requires UPDATE permission on at least one column.
-- The service never edits slot IDs; FK constraints retain referenced slots.
GRANT UPDATE(id) ON slots TO recovery_app;
GRANT SELECT,INSERT,DELETE ON sessions TO recovery_app;
GRANT SELECT,INSERT,UPDATE ON appointments,waitlist,offers TO recovery_app;
GRANT SELECT,INSERT ON audit TO recovery_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO recovery_app;
