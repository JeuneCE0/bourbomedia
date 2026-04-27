-- Drops the legacy daily_metrics table. All metrics are now computed live
-- from gh_appointments + gh_opportunities + clients (via /api/closing-stats),
-- so daily_metrics has no readers in the codebase anymore.

DROP TABLE IF EXISTS daily_metrics;
