-- Failed admin logins, used to lock out an IP after too many wrong passwords.
-- Rows older than the lockout window are deleted by the daily cleanup.
CREATE TABLE login_failures (
  ip TEXT    NOT NULL,
  at INTEGER NOT NULL -- Unix milliseconds
);
CREATE INDEX idx_login_failures_ip_at ON login_failures(ip, at);
