UPDATE sessions
SET state = 'exited',
    ended_at = unixepoch(),
    exit_code = NULL,
    reason = 'device_revoked'
WHERE state IN ('starting', 'running', 'lost')
  AND device_id IN (
      SELECT id
      FROM devices
      WHERE revoked_at IS NOT NULL
  );
