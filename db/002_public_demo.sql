-- Three bounded, shared request budgets. No visitor identifiers or IP addresses.
CREATE TABLE request_limits (
  kind text PRIMARY KEY CHECK(kind IN ('signin','action','state')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  used integer NOT NULL CHECK(used>0)
);
GRANT SELECT,INSERT,UPDATE ON request_limits TO recovery_app;
CREATE INDEX sessions_expiry ON sessions(expires_at);
